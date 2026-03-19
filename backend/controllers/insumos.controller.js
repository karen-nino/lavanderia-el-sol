import pool from '../db/pool.js';

export const getInsumos = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM insumos ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getInsumos error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createInsumo = async (req, res) => {
  const { nombre, categoria, unidad, stock_actual, stock_minimo, precio_unitario } = req.body;

  if (!nombre || !unidad) {
    return res.status(400).json({ message: 'Nombre y unidad son requeridos.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO insumos (nombre, categoria, unidad, stock_actual, stock_minimo, precio_unitario)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nombre, categoria || null, unidad, stock_actual ?? 0, stock_minimo ?? 0, precio_unitario ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createInsumo error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateInsumo = async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, unidad, stock_minimo, precio_unitario } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE insumos
       SET nombre          = COALESCE($1, nombre),
           descripcion     = COALESCE($2, descripcion),
           unidad          = COALESCE($3, unidad),
           stock_minimo    = COALESCE($4, stock_minimo),
           precio_unitario = COALESCE($5, precio_unitario)
       WHERE id = $6
       RETURNING *`,
      [nombre, descripcion, unidad, stock_minimo, precio_unitario, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Insumo no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateInsumo error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const putInsumo = async (req, res) => {
  const { id } = req.params;
  const { nombre, categoria, unidad, stock_actual, stock_minimo, precio_unitario } = req.body;

  if (!nombre || !unidad) {
    return res.status(400).json({ message: 'Nombre y unidad son requeridos.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE insumos
       SET nombre          = $1,
           categoria       = $2,
           unidad          = $3,
           stock_actual    = $4,
           stock_minimo    = $5,
           precio_unitario = $6
       WHERE id = $7
       RETURNING *`,
      [nombre, categoria || null, unidad, stock_actual ?? 0, stock_minimo ?? 0, precio_unitario ?? null, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Artículo no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('putInsumo error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const eliminarInsumo = async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ message: 'Solo los administradores pueden eliminar artículos.' });
  }
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM insumos WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Artículo no encontrado.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('eliminarInsumo error:', err);
    if (err.code === '23503') {
      return res.status(409).json({ message: 'No se puede eliminar: el artículo tiene movimientos registrados.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const registrarMovimiento = async (req, res) => {
  const { id } = req.params;
  const { tipo, cantidad, notas } = req.body;

  if (!tipo || !['entrada', 'salida'].includes(tipo)) {
    return res.status(400).json({ message: 'tipo debe ser "entrada" o "salida".' });
  }
  if (!cantidad || Number(cantidad) <= 0) {
    return res.status(400).json({ message: 'cantidad debe ser un número positivo.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloquear fila para lectura consistente
    const { rows: insumoRows } = await client.query(
      'SELECT stock_actual FROM insumos WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (insumoRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Insumo no encontrado.' });
    }

    const stockActual = Number(insumoRows[0].stock_actual);

    if (tipo === 'salida' && stockActual < Number(cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Stock insuficiente para registrar salida.' });
    }

    // Registrar movimiento
    await client.query(
      `INSERT INTO movimientos_insumos (insumo_id, usuario_id, tipo, cantidad, notas)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.user.id, tipo, cantidad, notas]
    );

    // Actualizar stock
    const delta = tipo === 'entrada' ? Number(cantidad) : -Number(cantidad);
    const { rows: updatedRows } = await client.query(
      'UPDATE insumos SET stock_actual = stock_actual + $1 WHERE id = $2 RETURNING *',
      [delta, id]
    );

    await client.query('COMMIT');
    res.status(201).json(updatedRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('registrarMovimiento error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};
