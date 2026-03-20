import pool from '../db/pool.js';

export const getProductos = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *, (stock_actual - stock_reservado) AS stock_disponible
       FROM productos
       ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getProductos error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createProducto = async (req, res) => {
  const { nombre, descripcion, unidad = 'pieza', precio_unitario, stock_actual = 0, stock_minimo = 0 } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO productos (nombre, descripcion, unidad, precio_unitario, stock_actual, stock_minimo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *, (stock_actual - stock_reservado) AS stock_disponible`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, stock_actual, stock_minimo]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateProducto = async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, unidad, precio_unitario, stock_actual, stock_minimo } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET nombre = $1, descripcion = $2, unidad = $3,
             precio_unitario = $4, stock_actual = $5, stock_minimo = $6,
             updated_at = NOW()
       WHERE id = $7
       RETURNING *, (stock_actual - stock_reservado) AS stock_disponible`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, stock_actual, stock_minimo, id]
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

export const deleteProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM productos WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('deleteProducto error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
