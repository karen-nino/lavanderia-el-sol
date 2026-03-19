import pool from '../db/pool.js';

const ESTADOS_VALIDOS     = ['RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['DEBE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande'];

// Genera folio LS-YYYYMMDD-XXXX a partir del id y la fecha de creación
function generarFolio(id, fecha) {
  const d = new Date(fecha);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(id).padStart(4, '0');
  return `LS-${yyyy}${mm}${dd}-${seq}`;
}

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

    // Insumos consumidos en la orden
    const { rows: movs } = await pool.query(
      `SELECT mi.*, i.nombre AS insumo_nombre, i.unidad
       FROM movimientos_insumos mi
       JOIN insumos i ON i.id = mi.insumo_id
       WHERE mi.orden_id = $1`,
      [id]
    );

    res.json({ ...rows[0], insumos_consumidos: movs });
  } catch (err) {
    console.error('getOrdenById error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

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
    insumos = [], // [{ insumo_id, cantidad }]
  } = req.body;

  // ── Validaciones ────────────────────────────────────────────

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

  // ── Precio total ─────────────────────────────────────────────
  // AUTOSERVICIO: captura manual (precio_total viene del body)
  // EDREDON / POR_ENCARGO: precio_base + ajuste
  //   precio_base es NULL hasta que se configure; cuando esté disponible
  //   se calculará aquí. Por ahora almacenamos NULL.
  const ajusteNum   = Number(ajuste) || 0;
  const precioBase  = null; // placeholder — se leerá de config cuando exista
  let   precioFinal;

  if (modalidad === 'AUTOSERVICIO') {
    precioFinal = precio_total ? Number(precio_total) : null;
  } else {
    precioFinal = precioBase !== null ? precioBase + ajusteNum : null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insertar la orden (usuario tomado del token)
    const { rows: ordenRows } = await client.query(
      `INSERT INTO ordenes
         (cliente_id, usuario_id, maquina_id, modalidad, estado_pago, sucursal,
          descripcion, peso_kg, precio_total, fecha_entrega, notas,
          tamano, precio_base, ajuste)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        cliente_id  || null,
        req.user.id,
        maquina_id  || null,
        modalidad,
        estado_pago,
        sucursal,
        descripcion || null,
        peso_kg     || null,
        precioFinal,
        fecha_entrega || null,
        notas       || null,
        tamano      ? String(tamano).toLowerCase() : null,
        precioBase,
        ajusteNum,
      ]
    );
    const orden = ordenRows[0];

    // Generar folio y guardarlo
    const folio = generarFolio(orden.id, orden.created_at);
    await client.query('UPDATE ordenes SET folio = $1 WHERE id = $2', [folio, orden.id]);
    orden.folio = folio;

    // Descontar insumos en Por Encargo y Autoservicio
    if (modalidad === 'POR_ENCARGO' || modalidad === 'AUTOSERVICIO') {
      for (const { insumo_id, cantidad } of insumos) {
        if (!insumo_id || !cantidad || cantidad <= 0) continue;

        // Verificar stock suficiente
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

        // Registrar movimiento de salida
        await client.query(
          `INSERT INTO movimientos_insumos (insumo_id, usuario_id, orden_id, tipo, cantidad)
           VALUES ($1, $2, $3, 'salida', $4)`,
          [insumo_id, req.user.id, orden.id, cantidad]
        );

        // Actualizar stock
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

export const eliminarOrden = async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo los administradores pueden eliminar órdenes.' });
  }
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM ordenes WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('eliminarOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

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

export const cambiarEstadoOrden = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  try {
    // El trigger actualiza updated_at automáticamente
    const { rows } = await pool.query(
      'UPDATE ordenes SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Orden no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('cambiarEstadoOrden error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
