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
  const { nombre, telefono, email, direccion, notas } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'El nombre es requerido.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, email, direccion, notas)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, telefono, email, direccion, notas]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createCliente error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateCliente = async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, email, direccion, notas, activo } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE clientes
       SET nombre    = COALESCE($1, nombre),
           telefono  = COALESCE($2, telefono),
           email     = COALESCE($3, email),
           direccion = COALESCE($4, direccion),
           notas     = COALESCE($5, notas),
           activo    = COALESCE($6, activo)
       WHERE id = $7
       RETURNING *`,
      [nombre, telefono, email, direccion, notas, activo, id]
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
