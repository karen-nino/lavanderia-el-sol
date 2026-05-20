import pool from '../db/pool.js';
import bcrypt from 'bcrypt';

const ROL_VALIDOS = ['admin', 'operador'];

const normalizarTelefono = (v) => (v ?? '').replace(/\D/g, '');

export const getEmpleados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, email, telefono, rol, activo, created_at
         FROM usuarios
        WHERE activo = TRUE
        ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getEmpleados error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createEmpleado = async (req, res) => {
  const { nombre, password, rol } = req.body;

  if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  const rolFinal = ROL_VALIDOS.includes(rol) ? rol : 'operador';

  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, password, rol)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, email, telefono, rol, activo, created_at`,
      [nombre.trim(), hashed, rolFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateEmpleado = async (req, res) => {
  const { id } = req.params;
  const { nombre, email, telefono, password, rol } = req.body;
  const updates = [];
  const values  = [];
  let i = 1;

  if (nombre !== undefined) {
    if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
    updates.push(`nombre = $${i++}`); values.push(nombre.trim());
  }
  if (email !== undefined) {
    if (!email.trim()) return res.status(400).json({ message: 'El email no puede estar vacío.' });
    updates.push(`email = $${i++}`); values.push(email.trim().toLowerCase());
  }
  if (telefono !== undefined) {
    const digitos = normalizarTelefono(telefono);
    if (digitos.length !== 10) {
      return res.status(400).json({ message: 'El teléfono debe tener 10 dígitos.' });
    }
    updates.push(`telefono = $${i++}`); values.push(digitos);
  }
  if (rol !== undefined) {
    if (!ROL_VALIDOS.includes(rol)) {
      return res.status(400).json({ message: 'Rol inválido.' });
    }
    if (Number(id) === req.user.id && rol !== 'admin') {
      return res.status(400).json({ message: 'No puedes cambiar tu propio rol de admin.' });
    }
    updates.push(`rol = $${i++}`); values.push(rol);
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    updates.push(`password = $${i++}`); values.push(hashed);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay campos para actualizar.' });
  }
  values.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')}
         WHERE id = $${i} AND activo = TRUE
         RETURNING id, nombre, email, telefono, rol, activo, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const campo = err.constraint === 'usuarios_telefono_key' ? 'teléfono' : 'email';
      return res.status(409).json({ message: `El ${campo} ya está en uso.` });
    }
    console.error('updateEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteEmpleado = async (req, res) => {
  const { id } = req.params;

  if (Number(id) === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET activo = FALSE
         WHERE id = $1 AND activo = TRUE
         RETURNING id`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json({ message: 'Empleado eliminado.' });
  } catch (err) {
    console.error('deleteEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
