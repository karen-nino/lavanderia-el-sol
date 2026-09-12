import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Ventas cobradas DENTRO de una sesión de caja.
//
// Se suman por `notas.caja_id` (mig. 101), que el trigger del pago fija al
// cobrar. Antes se preguntaba por ventana de tiempo ("¿qué notas pagadas caen
// entre la apertura y el cierre?"), y eso hacía que un corte ya cerrado
// cambiara solo cuando alguien revertía un pago viejo.
//
// Se devuelven desglosadas por forma de pago porque SOLO el efectivo entra al
// cajón: sumar transferencias y tarjetas al esperado hacía que el corte
// marcara un faltante que nadie se robó. Las notas viejas sin forma_pago se
// cuentan como efectivo (mig. 090 ya las rellenó; el COALESCE cubre cualquier
// fila que se cuele después). Una nota cancelada no es una venta: su dinero se
// devolvió.
async function ventasDeSesion(client, cajaId) {
  const { rows } = await client.query(
    `SELECT
        COALESCE(SUM(precio_total), 0) AS total,
        COALESCE(SUM(precio_total) FILTER (
          WHERE COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'), 0) AS efectivo,
        COALESCE(SUM(precio_total) FILTER (WHERE forma_pago = 'TRANSFERENCIA'), 0) AS transferencia,
        COALESCE(SUM(precio_total) FILTER (WHERE forma_pago = 'TARJETA'), 0) AS tarjeta
       FROM notas
      WHERE caja_id = $1
        AND estado_pago = 'PAGADO'
        AND estado <> 'CANCELADA'`,
    [cajaId]
  );
  const r = rows[0];
  return {
    total:         parseFloat(r.total),
    efectivo:      parseFloat(r.efectivo),
    transferencia: parseFloat(r.transferencia),
    tarjeta:       parseFloat(r.tarjeta),
  };
}

// Totales de movimientos (entradas/salidas) de una caja.
async function totalesMovimientos(client, cajaId) {
  const { rows } = await client.query(
    `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN monto ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN monto ELSE 0 END), 0) AS salidas
       FROM movimientos_caja
      WHERE caja_id = $1`,
    [cajaId]
  );
  return {
    entradas: parseFloat(rows[0].entradas),
    salidas:  parseFloat(rows[0].salidas),
  };
}

// Con cuánto dinero debe abrirse la próxima caja de una sucursal: lo que quedó
// en el cajón al cerrar la anterior. El fondo dejó de ser un número que cada
// quien teclea — el efectivo no aparece ni desaparece de un día para otro.
//
// De un corte normal se arrastra lo CONTADO (el dinero que de verdad está en el
// cajón, no el teórico). De un cierre automático nadie contó nada, así que se
// arrastra lo esperado y se avisa en pantalla para que revisen el cajón.
//
// Devuelve null cuando la sucursal nunca ha cerrado una caja: ahí no hay nada
// que arrastrar y el fondo lo captura un administrador.
async function aperturaSugerida(client, sucursal) {
  const { rows } = await client.query(
    `SELECT c.id, c.monto_inicial, c.monto_contado, c.cerrada_at, c.cierre_automatico,
            -- Igual que el historial: las cifras congeladas (mig. 101) y, para
            -- los cortes anteriores a esa migración, el cálculo en vivo.
            COALESCE(c.ventas_efectivo, (
              SELECT COALESCE(SUM(precio_total), 0) FROM notas
               WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
                 AND COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'
            )) AS ventas_efectivo,
            COALESCE(c.total_entradas, (
              SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
               WHERE caja_id = c.id AND tipo = 'entrada'
            )) AS total_entradas,
            COALESCE(c.total_salidas, (
              SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
               WHERE caja_id = c.id AND tipo = 'salida'
            )) AS total_salidas
       FROM cajas c
      WHERE c.estado = 'cerrada' AND c.sucursal = $1
      ORDER BY c.cerrada_at DESC
      LIMIT 1`,
    [sucursal]
  );
  if (rows.length === 0) return null;

  const c = rows[0];
  const esperado = parseFloat(c.monto_inicial)
                 + parseFloat(c.ventas_efectivo)
                 + parseFloat(c.total_entradas)
                 - parseFloat(c.total_salidas);
  const contado = c.monto_contado != null ? parseFloat(c.monto_contado) : null;
  const sinConteo = contado == null;

  return {
    // Nunca negativo: un cierre con más salidas que efectivo dejaría el cajón
    // en rojo, y un fondo negativo no existe.
    monto:  Math.max(0, sinConteo ? esperado : contado),
    origen: sinConteo ? 'cierre_automatico' : 'corte',
    corte: {
      id:            c.id,
      cerrada_at:    c.cerrada_at,
      monto_contado: contado,
      esperado,
    },
  };
}

export async function getCajaActual(req, res) {
  const client = await pool.connect();
  try {
    const cajaRes = await client.query(
      `SELECT c.*, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_apertura
         FROM cajas c
         JOIN usuarios u ON u.id = c.usuario_apertura_id
        WHERE c.estado = 'abierta' AND c.sucursal = $1
        LIMIT 1`,
      [req.sucursal]
    );

    if (cajaRes.rowCount === 0) {
      // Sin caja abierta, lo que importa es con cuánto se abre la siguiente.
      return res.json({ abierta: false, apertura_sugerida: await aperturaSugerida(client, req.sucursal) });
    }

    const caja = cajaRes.rows[0];

    const movsRes = await client.query(
      `SELECT mc.id, mc.tipo, mc.concepto, mc.monto, mc.created_at, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario
         FROM movimientos_caja mc
         JOIN usuarios u ON u.id = mc.usuario_id
        WHERE mc.caja_id = $1
        ORDER BY mc.created_at DESC`,
      [caja.id]
    );

    const ventas = await ventasDeSesion(client, caja.id);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    // El esperado en el cajón solo cuenta el efectivo; transferencias y
    // tarjetas se informan aparte para cuadrar el total del día.
    const esperado = monto_inicial + ventas.efectivo + entradas - salidas;

    res.json({
      abierta: true,
      caja: {
        id:               caja.id,
        usuario_apertura_id: caja.usuario_apertura_id,
        usuario_apertura: caja.usuario_apertura,
        monto_inicial,
        notas_apertura:   caja.notas_apertura,
        abierta_at:       caja.abierta_at,
      },
      totales: { ventas: ventas.total, ventas_desglose: ventas, entradas, salidas, esperado },
      movimientos: movsRes.rows.map((m) => ({
        id:         m.id,
        tipo:       m.tipo,
        concepto:   m.concepto,
        monto:      parseFloat(m.monto),
        usuario:    m.usuario,
        created_at: m.created_at,
      })),
    });
  } catch (err) {
    console.error('Error en caja/actual:', err);
    res.status(500).json({ message: 'No se pudo cargar la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

// El fondo de apertura NO es libre: sale del corte anterior (ver
// `aperturaSugerida`). Un empleado solo confirma ese monto; ajustarlo es cosa
// de un administrador, que es quien responde por el dinero del cajón.
export async function abrirCaja(req, res) {
  const { monto_inicial, notas } = req.body;

  const client = await pool.connect();
  try {
    // Ya hay una caja abierta: eso se responde antes que cualquier regla de
    // rol, para que el mensaje diga lo que de verdad pasa.
    const abierta = await client.query(
      `SELECT 1 FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (abierta.rowCount > 0) {
      return res.status(409).json({ message: 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' });
    }

    const sugerida = await aperturaSugerida(client, req.sucursal);
    const admin = esAdmin(req.user?.rol);

    let monto;
    if (admin) {
      // El admin puede ajustarlo; si no manda nada, va lo del corte anterior.
      monto = monto_inicial === undefined || monto_inicial === null || monto_inicial === ''
        ? sugerida?.monto
        : Number(monto_inicial);
      if (monto == null) {
        return res.status(400).json({ message: 'Captura el fondo inicial para abrir la caja.' });
      }
    } else {
      if (!sugerida) {
        return res.status(403).json({
          message: 'No hay un corte anterior del cual tomar el fondo. Pide a un administrador que abra la caja.',
        });
      }
      // Llega un monto distinto al del corte: la pantalla lo tiene bloqueado,
      // así que esto es alguien llamando a la API por su cuenta.
      if (monto_inicial !== undefined && monto_inicial !== null && monto_inicial !== ''
          && Number(monto_inicial) !== sugerida.monto) {
        return res.status(403).json({
          message: 'El fondo lo fija el corte anterior. Solo un administrador puede ajustarlo.',
        });
      }
      monto = sugerida.monto;
    }

    if (!Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ message: 'El monto inicial debe ser un número mayor o igual a 0.' });
    }

    const { rows } = await client.query(
      `INSERT INTO cajas (usuario_apertura_id, monto_inicial, notas_apertura, sucursal)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.id, monto, notas?.trim() || null, req.sucursal]
    );
    res.status(201).json({ id: rows[0].id, monto_inicial: monto });
  } catch (err) {
    // Índice único parcial: ya hay una caja abierta.
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' });
    }
    console.error('Error en caja/abrir:', err);
    res.status(500).json({ message: 'No se pudo abrir la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

export async function registrarMovimiento(req, res) {
  const { tipo, concepto, monto } = req.body;
  const cantidad = Number(monto);

  if (tipo !== 'entrada' && tipo !== 'salida') {
    return res.status(400).json({ message: 'El movimiento debe ser una entrada o una salida.' });
  }
  if (!concepto?.trim()) {
    return res.status(400).json({ message: 'El concepto es obligatorio.' });
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return res.status(400).json({ message: 'El monto debe ser un número mayor a 0.' });
  }

  try {
    const cajaRes = await pool.query(
      `SELECT id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (cajaRes.rowCount === 0) {
      return res.status(409).json({ message: 'No hay una caja abierta.' });
    }
    const cajaId = cajaRes.rows[0].id;

    const { rows } = await pool.query(
      `INSERT INTO movimientos_caja (caja_id, usuario_id, tipo, concepto, monto)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [cajaId, req.user.id, tipo, concepto.trim(), cantidad]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error('Error en caja/movimientos:', err);
    res.status(500).json({ message: 'No se pudo registrar el movimiento de caja. Intenta de nuevo.' });
  }
}

export async function cerrarCaja(req, res) {
  const { monto_contado, notas_cierre } = req.body;
  const contado = Number(monto_contado);

  if (!Number.isFinite(contado) || contado < 0) {
    return res.status(400).json({ message: 'El monto contado debe ser un número mayor o igual a 0.' });
  }

  const client = await pool.connect();
  try {
    // Transacción con bloqueo de fila: dos cierres simultáneos ya no se
    // pisan — el segundo espera, encuentra la caja cerrada y recibe 409.
    await client.query('BEGIN');

    const cajaRes = await client.query(
      `SELECT * FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1 FOR UPDATE`,
      [req.sucursal]
    );
    if (cajaRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'No hay una caja abierta.' });
    }
    const caja = cajaRes.rows[0];

    const ventas = await ventasDeSesion(client, caja.id);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    // El esperado en el cajón solo cuenta el efectivo; transferencias y
    // tarjetas se informan aparte para cuadrar el total del día.
    const esperado = monto_inicial + ventas.efectivo + entradas - salidas;
    const diferencia = contado - esperado;

    // Las cifras se COPIAN al corte (mig. 101). A partir de aquí el historial
    // las lee tal cual: lo que pase después con esas notas —revertir un pago,
    // editar un total— ya no puede reescribir un corte cerrado.
    const upd = await client.query(
      `UPDATE cajas
          SET estado = 'cerrada',
              usuario_cierre_id = $1,
              monto_contado = $2,
              notas_cierre = $3,
              cerrada_at = NOW(),
              ventas_total         = $5,
              ventas_efectivo      = $6,
              ventas_transferencia = $7,
              ventas_tarjeta       = $8,
              total_entradas       = $9,
              total_salidas        = $10
        WHERE id = $4 AND estado = 'abierta'`,
      [req.user.id, contado, notas_cierre?.trim() || null, caja.id,
       ventas.total, ventas.efectivo, ventas.transferencia, ventas.tarjeta,
       entradas, salidas]
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'La caja ya fue cerrada por alguien más.' });
    }

    await client.query('COMMIT');

    res.json({
      id: caja.id,
      resumen: {
        monto_inicial,
        ventas: ventas.total,
        ventas_desglose: ventas,
        entradas,
        salidas,
        esperado,
        contado,
        diferencia,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en caja/cerrar:', err);
    res.status(500).json({ message: 'No se pudo cerrar la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

export async function getHistorial(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
          c.id,
          c.monto_inicial,
          c.monto_contado,
          c.notas_apertura,
          c.notas_cierre,
          c.abierta_at,
          c.cerrada_at,
          c.cierre_automatico,
          TRIM(ua.nombre || ' ' || COALESCE(ua.apellido, '')) AS usuario_apertura,
          TRIM(uc.nombre || ' ' || COALESCE(uc.apellido, '')) AS usuario_cierre,
          -- Cifras CONGELADAS al cerrar (mig. 101). Un corte cerrado ya no
          -- se recalcula: revertir un pago o editar un total no puede
          -- reescribir lo que se contó aquel día.
          --
          -- El COALESCE cubre los cortes anteriores a la migración, que no
          -- tienen copia: esos se siguen sumando desde sus notas, ahora por
          -- caja_id (el backfill de la 101 lo llenó) en vez de por ventana.
          COALESCE(c.ventas_total, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
          )) AS ventas,
          COALESCE(c.ventas_efectivo, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'
          )) AS ventas_efectivo,
          COALESCE(c.ventas_transferencia, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND forma_pago = 'TRANSFERENCIA'
          )) AS ventas_transferencia,
          COALESCE(c.ventas_tarjeta, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND forma_pago = 'TARJETA'
          )) AS ventas_tarjeta,
          COALESCE(c.total_entradas, (
            SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'entrada'
          )) AS entradas,
          COALESCE(c.total_salidas, (
            SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'salida'
          )) AS salidas
        FROM cajas c
        JOIN usuarios ua ON ua.id = c.usuario_apertura_id
        LEFT JOIN usuarios uc ON uc.id = c.usuario_cierre_id
       WHERE c.estado = 'cerrada' AND c.sucursal = $1
       ORDER BY c.cerrada_at DESC`,
      [req.sucursal]
    );

    res.json(
      rows.map((r) => {
        const monto_inicial = parseFloat(r.monto_inicial);
        const ventas        = parseFloat(r.ventas);
        const ventas_desglose = {
          total:         ventas,
          efectivo:      parseFloat(r.ventas_efectivo),
          transferencia: parseFloat(r.ventas_transferencia),
          tarjeta:       parseFloat(r.ventas_tarjeta),
        };
        const entradas      = parseFloat(r.entradas);
        const salidas       = parseFloat(r.salidas);
        const esperado      = monto_inicial + ventas_desglose.efectivo + entradas - salidas;
        const contado       = r.monto_contado != null ? parseFloat(r.monto_contado) : null;
        return {
          id:               r.id,
          usuario_apertura: r.usuario_apertura,
          usuario_cierre:   r.usuario_cierre,
          abierta_at:        r.abierta_at,
          cerrada_at:        r.cerrada_at,
          // Cerrada por el barrido de medianoche, sin que nadie contara el
          // cajón: no es un corte, y la pantalla debe decirlo.
          cierre_automatico: r.cierre_automatico,
          notas_apertura:   r.notas_apertura,
          notas_cierre:     r.notas_cierre,
          monto_inicial,
          ventas,
          ventas_desglose,
          entradas,
          salidas,
          esperado,
          contado,
          diferencia: contado != null ? contado - esperado : null,
        };
      })
    );
  } catch (err) {
    console.error('Error en caja/historial:', err);
    res.status(500).json({ message: 'No se pudo cargar el historial de cortes. Intenta de nuevo.' });
  }
}

// ── DELETE /caja/historial/:id ──────────────────────────────
// Elimina un corte (sesión de caja ya cerrada) del historial. Solo Admin.
// Los movimientos de esa sesión se borran en cascada (ON DELETE CASCADE).
export async function eliminarCorte(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'No se reconoció el corte.' });

  try {
    const { rows } = await pool.query(
      `DELETE FROM cajas
        WHERE id = $1 AND sucursal = $2 AND estado = 'cerrada'
        RETURNING id`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Corte no encontrado o aún abierto.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Error al eliminar corte:', err);
    res.status(500).json({ message: 'No se pudo eliminar el corte. Intenta de nuevo.' });
  }
}
