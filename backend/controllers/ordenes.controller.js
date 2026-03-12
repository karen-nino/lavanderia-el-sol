import pool from '../db/pool.js';

const ESTADOS_VALIDOS    = ['RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];
const MODALIDADES_VALIDAS = ['POR_ENCARGO', 'AUTOSERVICIO'];
const ESTADOS_PAGO_VALIDOS = ['CONTADO', 'DEBE', 'N/A'];

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
              u.nombre   AS usuario_nombre
       FROM ordenes o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       JOIN      usuarios u ON u.id = o.usuario_id
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
              u.nombre   AS usuario_nombre
       FROM ordenes o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       JOIN      usuarios u ON u.id = o.usuario_id
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
    estado_pago = 'CONTADO',
    sucursal = 'lopez_cotilla',
    descripcion,
    peso_kg,
    precio_total,
    fecha_entrega,
    notas,
    insumos = [], // [{ insumo_id, cantidad }]
  } = req.body;

  // Validaciones
  if (modalidad === 'POR_ENCARGO' && !cliente_id) {
    return res.status(400).json({ message: 'cliente_id es requerido para órdenes Por Encargo.' });
  }
  if (!MODALIDADES_VALIDAS.includes(modalidad)) {
    return res.status(400).json({ message: `Modalidad inválida. Valores permitidos: ${MODALIDADES_VALIDAS.join(', ')}.` });
  }
  if (!ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({ message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.` });
  }
  // Autoservicio siempre es N/A en estado_pago
  const estadoPagoFinal = modalidad === 'AUTOSERVICIO' ? 'N/A' : estado_pago;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insertar la orden (usuario tomado del token)
    const { rows: ordenRows } = await client.query(
      `INSERT INTO ordenes
         (cliente_id, usuario_id, maquina_id, modalidad, estado_pago, sucursal,
          descripcion, peso_kg, precio_total, fecha_entrega, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        cliente_id || null,
        req.user.id,
        maquina_id || null,
        modalidad,
        estadoPagoFinal,
        sucursal,
        descripcion,
        peso_kg,
        precio_total,
        fecha_entrega,
        notas,
      ]
    );
    const orden = ordenRows[0];

    // Generar folio y guardarlo
    const folio = generarFolio(orden.id, orden.created_at);
    await client.query('UPDATE ordenes SET folio = $1 WHERE id = $2', [folio, orden.id]);
    orden.folio = folio;

    // Descontar insumos solo en Por Encargo
    if (modalidad === 'POR_ENCARGO') {
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
          return res.status(400).json({
            message: `Stock insuficiente para insumo ${insumo_id}.`,
          });
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

export const cambiarEstadoOrden = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  try {
    // El trigger actualiza updated_at automáticamente (sirve como timestamp del cambio)
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
