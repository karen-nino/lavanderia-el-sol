import pool from '../db/pool.js';

// Valida un teléfono: debe existir y contener solo dígitos.
// Devuelve un mensaje de error o null si es válido.
const validarTelefono = (telefono) => {
  const t = String(telefono ?? '').trim();
  if (!t) return 'El teléfono es requerido.';
  if (!/^\d+$/.test(t)) return 'El teléfono solo puede contener números.';
  return null;
};

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
  const { nombre, apellido, telefono, notas } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'El nombre es requerido.' });
  }

  const errorTelefono = validarTelefono(telefono);
  if (errorTelefono) {
    return res.status(400).json({ message: errorTelefono });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, apellido, telefono, notas)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [nombre, apellido, telefono, notas]
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
         AND estado NOT IN ('CANCELADA', 'FINALIZADA')`,
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
  const { nombre, apellido, telefono, notas, activo } = req.body;

  // Si se envía teléfono, debe ser válido (no vacío y solo dígitos).
  if (telefono !== undefined && telefono !== null) {
    const errorTelefono = validarTelefono(telefono);
    if (errorTelefono) {
      return res.status(400).json({ message: errorTelefono });
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE clientes
       SET nombre   = COALESCE($1, nombre),
           apellido = COALESCE($2, apellido),
           telefono = COALESCE($3, telefono),
           notas    = COALESCE($4, notas),
           activo   = COALESCE($5, activo)
       WHERE id = $6
       RETURNING *`,
      [nombre, apellido, telefono, notas, activo, id]
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
