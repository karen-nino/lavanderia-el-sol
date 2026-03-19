import pool from '../db/pool.js';

const ESTADOS_VALIDOS     = ['ACTIVA', 'EN_PROCESO', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['DEBE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande'];

// Transiciones permitidas por estado actual
const TRANSICIONES_VALIDAS = {
  ACTIVA:     ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['LISTA',      'CANCELADA'],
  LISTA:      ['PAGADA',     'CANCELADA'],
  PAGADA:     ['ENTREGADA',  'CANCELADA'],
  ENTREGADA:  [],
  CANCELADA:  [],
};

function generarFolio(id, fecha) {
  const d = new Date(fecha);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const seq  = String(id).padStart(4, '0');
  return `LS-${yyyy}${mm}${dd}-${seq}`;
}

// ── GET /ordenes ──────────────────────────────────────────────
export const getOrdenes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              c.nombre   AS cliente_nombre,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre
       FROM ordenes o
       LEFT JOIN clientes  c ON c.id = o.cliente_id
       JOIN      usuarios  u ON u.id = o.usuario_id
       LEFT JOIN maquinas  m ON m.id = o.maquina_id
       ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getOrdenes error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /ordenes/:id ──────────────────────────────────────────
export const getOrdenById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT o.*,
              c.nombre   AS cliente_nombre,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre
       FROM ordenes o
       LEFT JOIN clientes  c ON c.id = o.cliente_id
       JOIN      usuarios  u ON u.id = o.usuario_id
       LEFT JOIN maquinas  m ON m.id = o.maquina_id
       WHERE o.id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }

    const { rows: articulos } = await pool.query(
      `SELECT oa.id, oa.articulo_id, a.nombre, oa.cantidad, oa.precio_unitario,
              (oa.cantidad * oa.precio_unitario) AS subtotal
       FROM orden_articulos oa
       JOIN articulos a ON a.id = oa.articulo_id
       WHERE oa.orden_id = $1
       ORDER BY oa.created_at ASC`,
      [id]
    );

    const { rows: movs } = await pool.query(
      `SELECT mi.*, i.nombre AS insumo_nombre, i.unidad
       FROM movimientos_insumos mi
       JOIN insumos i ON i.id = mi.insumo_id
       WHERE mi.orden_id = $1`,
      [id]
    );

    res.json({ ...rows[0], articulos, insumos_consumidos: movs });
  } catch (err) {
    console.error('getOrdenById error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /ordenes ─────────────────────────────────────────────
export const createOrden = async (req, res) => {
  const {
    cliente_id,
    maquina_id,
    modalidad = 'POR_ENCARGO',
    estado_pago,
    sucursal = 'lopez_cotilla',
    descripcion,
    peso_kg,
    precio_total,
    fecha_entrega,
    notas,
    tamano,
    ajuste = 0,
    insumos = [],
  } = req.body;

  if (!MODALIDADES_VALIDAS.includes(modalidad)) {
    return res.status(400).json({
      message: `Modalidad inválida. Valores permitidos: ${MODALIDADES_VALIDAS.join(', ')}.`,
    });
  }
  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }
  if (modalidad === 'POR_ENCARGO') {
    if (!cliente_id) {
      return res.status(400).json({ message: 'cliente_id es requerido para órdenes Por Encargo.' });
    }
    if (!tamano || !TAMANOS_VALIDOS.includes(String(tamano).toLowerCase())) {
      return res.status(400).json({ message: 'tamano es requerido para Por Encargo (chico o grande).' });
    }
  }

  const ajusteNum  = Number(ajuste) || 0;
  const precioBase = null;
  let precioFinal;

  if (modalidad === 'AUTOSERVICIO') {
    precioFinal = precio_total ? Number(precio_total) : null;
  } else {
    precioFinal = precioBase !== null ? precioBase + ajusteNum : null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ordenRows } = await client.query(
      `INSERT INTO ordenes
         (cliente_id, usuario_id, maquina_id, modalidad, estado_pago, sucursal,
          descripcion, peso_kg, precio_total, fecha_entrega, notas,
          tamano, precio_base, ajuste)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        maquina_id   || null,
        modalidad,
        estado_pago,
        sucursal,
        descripcion  || null,
        peso_kg      || null,
        precioFinal,
        fecha_entrega || null,
        notas        || null,
        tamano ? String(tamano).toLowerCase() : null,
        precioBase,
        ajusteNum,
      ]
    );
    const orden = ordenRows[0];

    const folio = generarFolio(orden.id, orden.created_at);
    await client.query('UPDATE ordenes SET folio = $1 WHERE id = $2', [folio, orden.id]);
    orden.folio = folio;

    if (modalidad === 'POR_ENCARGO' || modalidad === 'AUTOSERVICIO') {
      for (const { insumo_id, cantidad } of insumos) {
        if (!insumo_id || !cantidad || cantidad <= 0) continue;

        const { rows: stockRows } = await client.query(
          'SELECT stock_actual FROM insumos WHERE id = $1 FOR UPDATE',
          [insumo_id]
        );
        if (stockRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: `Insumo ${insumo_id} no encontrado.` });
        }
        if (Number(stockRows[0].stock_actual) < cantidad) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Stock insuficiente para insumo ${insumo_id}.` });
        }

        await client.query(
          `INSERT INTO movimientos_insumos (insumo_id, usuario_id, orden_id, tipo, cantidad)
           VALUES ($1, $2, $3, 'salida', $4)`,
          [insumo_id, req.user.id, orden.id, cantidad]
        );
        await client.query(
          'UPDATE insumos SET stock_actual = stock_actual - $1 WHERE id = $2',
          [cantidad, insumo_id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(orden);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createOrden error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'cliente_id o maquina_id no existe.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── DELETE /ordenes/:id ───────────────────────────────────────
export const eliminarOrden = async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo los administradores pueden eliminar órdenes.' });
  }
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Liberar stock reservado antes de eliminar
    await client.query(
      `UPDATE articulos a
         SET stock_reservado = stock_reservado - oa.cantidad
       FROM orden_articulos oa
       WHERE oa.orden_id = $1 AND oa.articulo_id = a.id`,
      [id]
    );

    const { rowCount } = await client.query('DELETE FROM ordenes WHERE id = $1', [id]);
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('eliminarOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /ordenes/:id/estado ─────────────────────────────────
export const cambiarEstadoOrden = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ordenRows } = await client.query(
      'SELECT estado FROM ordenes WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (ordenRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }

    const estadoActual = ordenRows[0].estado;

    if (['ENTREGADA', 'CANCELADA'].includes(estadoActual)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede cambiar el estado de una orden ${estadoActual}.`,
      });
    }

    const permitidos = TRANSICIONES_VALIDAS[estadoActual] || [];
    if (!permitidos.includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Transición no válida: ${estadoActual} → ${estado}. Permitidas: ${permitidos.join(', ') || 'ninguna'}.`,
      });
    }

    if (estado === 'CANCELADA') {
      await client.query(
        `UPDATE articulos a
           SET stock_reservado = stock_reservado - oa.cantidad
         FROM orden_articulos oa
         WHERE oa.orden_id = $1 AND oa.articulo_id = a.id`,
        [id]
      );
    } else if (estado === 'PAGADA') {
      await client.query(
        `UPDATE articulos a
           SET stock_actual    = stock_actual    - oa.cantidad,
               stock_reservado = stock_reservado - oa.cantidad
         FROM orden_articulos oa
         WHERE oa.orden_id = $1 AND oa.articulo_id = a.id`,
        [id]
      );
    }

    const { rows } = await client.query(
      'UPDATE ordenes SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarEstadoOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /ordenes/:id/estado-pago ────────────────────────────
export const cambiarEstadoPago = async (req, res) => {
  const { id } = req.params;
  const { estado_pago } = req.body;

  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE ordenes SET estado_pago = $1 WHERE id = $2 RETURNING *',
      [estado_pago, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('cambiarEstadoPago error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /ordenes/:id/articulos ────────────────────────────────
export const getOrdenArticulos = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT oa.id, oa.articulo_id, a.nombre, oa.cantidad, oa.precio_unitario,
              (oa.cantidad * oa.precio_unitario) AS subtotal
       FROM orden_articulos oa
       JOIN articulos a ON a.id = oa.articulo_id
       WHERE oa.orden_id = $1
       ORDER BY oa.created_at ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('getOrdenArticulos error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /ordenes/:id/articulos ───────────────────────────────
export const addArticuloToOrden = async (req, res) => {
  const { id } = req.params;
  const { articulo_id, cantidad } = req.body;

  if (!articulo_id || !cantidad || Number(cantidad) <= 0) {
    return res.status(400).json({ message: 'articulo_id y cantidad (>0) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: artRows } = await client.query(
      'SELECT * FROM articulos WHERE id = $1 FOR UPDATE',
      [articulo_id]
    );
    if (artRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Artículo no encontrado.' });
    }
    const art = artRows[0];
    const stockDisponible = art.stock_actual - art.stock_reservado;

    if (stockDisponible < Number(cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Stock insuficiente. Disponible: ${stockDisponible}, solicitado: ${cantidad}.`,
      });
    }

    const { rows: oaRows } = await client.query(
      `INSERT INTO orden_articulos (orden_id, articulo_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, articulo_id, cantidad, art.precio_unitario ?? 0]
    );

    await client.query(
      'UPDATE articulos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
      [cantidad, articulo_id]
    );

    await client.query(
      `UPDATE ordenes
         SET precio_total = (
           SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
           FROM orden_articulos WHERE orden_id = $1
         )
       WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.status(201).json(oaRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('addArticuloToOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── DELETE /ordenes/:id/articulos/:articuloId ─────────────────
export const removeArticuloFromOrden = async (req, res) => {
  const { id, articuloId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: oaRows } = await client.query(
      'SELECT * FROM orden_articulos WHERE orden_id = $1 AND articulo_id = $2',
      [id, articuloId]
    );
    if (oaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Artículo no encontrado en la orden.' });
    }
    const oa = oaRows[0];

    await client.query(
      'DELETE FROM orden_articulos WHERE orden_id = $1 AND articulo_id = $2',
      [id, articuloId]
    );

    await client.query(
      'UPDATE articulos SET stock_reservado = stock_reservado - $1 WHERE id = $2',
      [oa.cantidad, articuloId]
    );

    await client.query(
      `UPDATE ordenes
         SET precio_total = (
           SELECT COALESCE(SUM(cantidad * precio_unitario), 0)
           FROM orden_articulos WHERE orden_id = $1
         )
       WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('removeArticuloFromOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};
