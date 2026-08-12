import pool from '../db/pool.js';

// Suma de ventas cobradas durante la ventana de la sesión de caja,
// atribuidas al momento del cobro (pagado_en, migración 037): una nota
// creada ayer y cobrada hoy cuenta en el corte de hoy.
async function ventasDeSesion(client, abiertaAt, cerradaAt, sucursal) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(precio_total), 0) AS ventas
       FROM notas
      WHERE estado_pago = 'PAGADO'
        AND sucursal = $3
        AND pagado_en >= $1
        AND pagado_en <= COALESCE($2, NOW())`,
    [abiertaAt, cerradaAt, sucursal]
  );
  return parseFloat(rows[0].ventas);
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

    const ventas = await ventasDeSesion(client, caja.abierta_at, null, req.sucursal);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    const esperado = monto_inicial + ventas + entradas - salidas;

    res.json({
      abierta: true,
      caja: {
        id:               caja.id,
        usuario_apertura: caja.usuario_apertura,
        monto_inicial,
        notas_apertura:   caja.notas_apertura,
        abierta_at:       caja.abierta_at,
      },
      totales: { ventas, entradas, salidas, esperado },
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
    res.status(500).json({ message: 'Error al obtener la caja actual.' });
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
    res.status(500).json({ message: 'Error al abrir la caja.' });
  }
}

export async function registrarMovimiento(req, res) {
  const { tipo, concepto, monto } = req.body;
  const cantidad = Number(monto);

  if (tipo !== 'entrada' && tipo !== 'salida') {
    return res.status(400).json({ message: 'El tipo debe ser "entrada" o "salida".' });
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
    res.status(500).json({ message: 'Error al registrar el movimiento.' });
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

    const ventas = await ventasDeSesion(client, caja.abierta_at, null, req.sucursal);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    const esperado = monto_inicial + ventas + entradas - salidas;
    const diferencia = contado - esperado;

    const upd = await client.query(
      `UPDATE cajas
          SET estado = 'cerrada',
              usuario_cierre_id = $1,
              monto_contado = $2,
              notas_cierre = $3,
              cerrada_at = NOW()
        WHERE id = $4 AND estado = 'abierta'`,
      [req.user.id, contado, notas_cierre?.trim() || null, caja.id]
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
        ventas,
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
    res.status(500).json({ message: 'Error al cerrar la caja.' });
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
          TRIM(ua.nombre || ' ' || COALESCE(ua.apellido, '')) AS usuario_apertura,
          TRIM(uc.nombre || ' ' || COALESCE(uc.apellido, '')) AS usuario_cierre,
          COALESCE((
            SELECT SUM(precio_total) FROM notas
             WHERE estado_pago = 'PAGADO'
               AND sucursal = c.sucursal
               AND pagado_en >= c.abierta_at
               AND pagado_en <= c.cerrada_at
          ), 0) AS ventas,
          COALESCE((
            SELECT SUM(monto) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'entrada'
          ), 0) AS entradas,
          COALESCE((
            SELECT SUM(monto) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'salida'
          ), 0) AS salidas
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
        const entradas      = parseFloat(r.entradas);
        const salidas       = parseFloat(r.salidas);
        const esperado      = monto_inicial + ventas + entradas - salidas;
        const contado       = r.monto_contado != null ? parseFloat(r.monto_contado) : null;
        return {
          id:               r.id,
          usuario_apertura: r.usuario_apertura,
          usuario_cierre:   r.usuario_cierre,
          abierta_at:       r.abierta_at,
          cerrada_at:       r.cerrada_at,
          notas_apertura:   r.notas_apertura,
          notas_cierre:     r.notas_cierre,
          monto_inicial,
          ventas,
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
    res.status(500).json({ message: 'Error al obtener el historial de cortes.' });
  }
}

// ── DELETE /caja/historial/:id ──────────────────────────────
// Elimina un corte (sesión de caja ya cerrada) del historial. Solo Admin.
// Los movimientos de esa sesión se borran en cascada (ON DELETE CASCADE).
export async function eliminarCorte(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Corte inválido.' });

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
    res.status(500).json({ message: 'Error al eliminar el corte.' });
  }
}
