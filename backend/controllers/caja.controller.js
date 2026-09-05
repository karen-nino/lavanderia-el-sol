import pool from '../db/pool.js';

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
      return res.json({ abierta: false });
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

export async function abrirCaja(req, res) {
  const { monto_inicial, notas } = req.body;
  const monto = Number(monto_inicial);

  if (!Number.isFinite(monto) || monto < 0) {
    return res.status(400).json({ message: 'El monto inicial debe ser un número mayor o igual a 0.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO cajas (usuario_apertura_id, monto_inicial, notas_apertura, sucursal)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.id, monto, notas?.trim() || null, req.sucursal]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    // Índice único parcial: ya hay una caja abierta.
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' });
    }
    console.error('Error en caja/abrir:', err);
    res.status(500).json({ message: 'No se pudo abrir la caja. Intenta de nuevo.' });
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
