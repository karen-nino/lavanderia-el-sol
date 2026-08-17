import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Para productos por tapa/medida el mínimo se lleva por producto (en tapas);
// para los demás se usa el mínimo global de Ajustes.
const ESTADO_STOCK_SQL = `
  CASE
    WHEN (stock_actual - stock_reservado) = 0
      THEN 'agotado'
    WHEN (stock_actual - stock_reservado) <= (
           CASE WHEN es_por_tapa
                THEN stock_minimo
                ELSE (SELECT stock_minimo_global FROM ajustes WHERE id = 1)
           END)
      THEN 'por_agotarse'
    ELSE 'ok'
  END AS estado_stock
`.trim();

export const getProductos = async (req, res) => {
  // Por defecto solo productos activos; con ?archivados=1 devuelve los archivados
  // (para la vista de "ver archivados / restaurar").
  const soloArchivados = req.query.archivados === '1';
  try {
    const { rows } = await pool.query(
      `SELECT *,
              (stock_actual - stock_reservado) AS stock_disponible,
              ${ESTADO_STOCK_SQL}
       FROM productos
       WHERE sucursal = $1 AND archivado = $2
       ORDER BY nombre ASC`,
      [req.sucursal, soloArchivados]
    );
    res.json(rows);
  } catch (err) {
    console.error('getProductos error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// Archivar (ocultar) o restaurar un producto. Solo admin. No borra nada: el
// producto sigue existiendo para el historial de las notas viejas.
export const archivarProducto = async (req, res) => {
  const { id } = req.params;
  const archivado = req.body?.archivado !== false; // por defecto archiva
  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET archivado = $1, updated_at = NOW()
       WHERE id = $2 AND sucursal = $3
       RETURNING *,
                 (stock_actual - stock_reservado) AS stock_disponible,
                 ${ESTADO_STOCK_SQL}`,
      [archivado, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('archivarProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createProducto = async (req, res) => {
  const {
    nombre, descripcion, unidad = 'pieza', precio_unitario, stock_actual = 0, marca,
    es_por_tapa = false, tapas_por_envase, envase, stock_minimo = 0,
    volumen_envase_ml, tapa_ml,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }
  if (es_por_tapa && (!tapas_por_envase || Number(tapas_por_envase) <= 0)) {
    return res.status(400).json({ message: 'Indica cuántas tapas rinde el envase.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO productos
         (nombre, descripcion, unidad, precio_unitario, stock_actual, marca, sucursal,
          es_por_tapa, tapas_por_envase, envase, stock_minimo, volumen_envase_ml, tapa_ml)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *,
                 (stock_actual - stock_reservado) AS stock_disponible,
                 ${ESTADO_STOCK_SQL}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, stock_actual, marca || null, req.sucursal,
       !!es_por_tapa, es_por_tapa ? Number(tapas_por_envase) : null, es_por_tapa ? (envase || null) : null,
       Number(stock_minimo) || 0,
       es_por_tapa && volumen_envase_ml ? Number(volumen_envase_ml) : null,
       es_por_tapa && tapa_ml ? Number(tapa_ml) : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateProducto = async (req, res) => {
  const { id } = req.params;
  const {
    nombre, descripcion, unidad, precio_unitario, stock_actual, marca,
    es_por_tapa = false, tapas_por_envase, envase, stock_minimo = 0,
    volumen_envase_ml, tapa_ml,
  } = req.body;

  // Un empleado (no admin) solo puede ajustar el stock; los demás campos
  // (nombre, precio, unidad...) se conservan intactos.
  if (!esAdmin(req.user.rol)) {
    if (stock_actual === undefined || stock_actual === null || Number.isNaN(Number(stock_actual))) {
      return res.status(400).json({ message: 'Stock actual inválido.' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE productos
           SET stock_actual = $1, updated_at = NOW()
         WHERE id = $2 AND sucursal = $3
         RETURNING *,
                   (stock_actual - stock_reservado) AS stock_disponible,
                   ${ESTADO_STOCK_SQL}`,
        [Number(stock_actual), id, req.sucursal]
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Producto no encontrado.' });
      }
      return res.json(rows[0]);
    } catch (err) {
      console.error('updateProducto (stock) error:', err);
      return res.status(500).json({ message: 'Error interno del servidor.' });
    }
  }

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }
  if (es_por_tapa && (!tapas_por_envase || Number(tapas_por_envase) <= 0)) {
    return res.status(400).json({ message: 'Indica cuántas tapas rinde el envase.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET nombre = $1, descripcion = $2, unidad = $3,
             precio_unitario = $4, stock_actual = $5, marca = $8,
             es_por_tapa = $9, tapas_por_envase = $10, envase = $11, stock_minimo = $12,
             volumen_envase_ml = $13, tapa_ml = $14,
             updated_at = NOW()
       WHERE id = $6 AND sucursal = $7
       RETURNING *,
                 (stock_actual - stock_reservado) AS stock_disponible,
                 ${ESTADO_STOCK_SQL}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, stock_actual, id, req.sucursal, marca || null,
       !!es_por_tapa, es_por_tapa ? Number(tapas_por_envase) : null, es_por_tapa ? (envase || null) : null,
       Number(stock_minimo) || 0,
       es_por_tapa && volumen_envase_ml ? Number(volumen_envase_ml) : null,
       es_por_tapa && tapa_ml ? Number(tapa_ml) : null]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// Borrado múltiple (solo admin). Igual que en clientes, con dos modos según
// `confirmar`:
//   • confirmar = false → verificación (dry-run): no borra; devuelve los
//     productos con ventas registradas (bloqueados) y los ids eliminables.
//   • confirmar = true  → borra los eliminables (omite los bloqueados) en una
//     transacción.
// Un producto referenciado en nota_productos (con ventas) no se puede borrar
// por la restricción de llave foránea. Todo acotado a la sucursal.
export const deleteProductosMultiples = async (req, res) => {
  const { ids, confirmar } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No se recibieron productos a eliminar.' });
  }
  const idsNum = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (idsNum.length === 0) {
    return res.status(400).json({ message: 'Productos inválidos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: productos } = await client.query(
      'SELECT id, nombre FROM productos WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [idsNum, req.sucursal]
    );
    const idsValidos = productos.map((p) => p.id);

    // Productos con ventas registradas: no se pueden borrar.
    let bloqueadosSet = new Set();
    if (idsValidos.length > 0) {
      const { rows } = await client.query(
        'SELECT DISTINCT producto_id FROM nota_productos WHERE producto_id = ANY($1)',
        [idsValidos]
      );
      bloqueadosSet = new Set(rows.map((r) => r.producto_id));
    }

    const bloqueados  = productos.filter((p) => bloqueadosSet.has(p.id));
    const eliminables = productos.filter((p) => !bloqueadosSet.has(p.id));

    if (!confirmar) {
      await client.query('ROLLBACK');
      return res.json({ bloqueados, eliminables: eliminables.map((p) => p.id) });
    }

    let eliminados = [];
    if (eliminables.length > 0) {
      const { rows } = await client.query(
        'DELETE FROM productos WHERE id = ANY($1) AND sucursal = $2 RETURNING id',
        [eliminables.map((p) => p.id), req.sucursal]
      );
      eliminados = rows.map((r) => r.id);
    }
    await client.query('COMMIT');
    res.json({ eliminados, bloqueados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteProductosMultiples error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

export const deleteProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM productos WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('deleteProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
