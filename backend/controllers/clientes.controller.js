import pool from '../db/pool.js';

export const getClientes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clientes WHERE activo = TRUE ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getClientes error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const getClienteById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clientes WHERE id = $1 AND activo = TRUE',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('getClienteById error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createCliente = async (req, res) => {
  const { nombre, telefono, notas } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'El nombre es requerido.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, notas)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre, telefono, notas]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createCliente error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteCliente = async (req, res) => {
  const { id } = req.params;

  try {
    // Verificar notas activas
    const { rows: activas } = await pool.query(
      `SELECT id FROM notas
       WHERE cliente_id = $1
         AND estado NOT IN ('CANCELADA', 'ENTREGADA')`,
      [id]
    );
    if (activas.length > 0) {
      return res.status(400).json({ message: 'No se puede eliminar un cliente con notas activas.' });
    }

    const { rows } = await pool.query(
      'DELETE FROM clientes WHERE id = $1 RETURNING id',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json({ message: 'Cliente eliminado.' });
  } catch (err) {
    console.error('deleteCliente error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateCliente = async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, notas, activo } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE clientes
       SET nombre   = COALESCE($1, nombre),
           telefono = COALESCE($2, telefono),
           notas    = COALESCE($3, notas),
           activo   = COALESCE($4, activo)
       WHERE id = $5
       RETURNING *`,
      [nombre, telefono, notas, activo, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateCliente error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
