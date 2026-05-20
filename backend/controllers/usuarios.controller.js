import pool from '../db/pool.js';
import bcrypt from 'bcrypt';

const ROL_VALIDOS = ['admin_main', 'admin', 'operador'];

export const getEmpleados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, rol, activo, created_at
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

  if (rolFinal === 'admin_main' && req.user.rol !== 'admin_main') {
    return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, password, rol)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, rol, activo, created_at`,
      [nombre.trim(), hashed, rolFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);
  const { nombre, password, rol } = req.body;
  const callerEsMain = req.user.rol === 'admin_main';

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    const target = targetRows[0];

    if (target.rol === 'admin_main' && !callerEsMain) {
      return res.status(403).json({ message: 'Solo el Admin Main puede modificar al Admin Main.' });
    }

    const updates = [];
    const values  = [];
    let i = 1;

    if (nombre !== undefined) {
      if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
      updates.push(`nombre = $${i++}`); values.push(nombre.trim());
    }
    if (rol !== undefined) {
      if (!ROL_VALIDOS.includes(rol)) {
        return res.status(400).json({ message: 'Rol inválido.' });
      }
      if (targetId === req.user.id) {
        return res.status(400).json({ message: 'No puedes cambiar tu propio rol.' });
      }
      if (rol === 'admin_main' && !callerEsMain) {
        return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
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
    values.push(targetId);

    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')}
         WHERE id = $${i} AND activo = TRUE
         RETURNING id, nombre, rol, activo, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario.' });
  }

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    if (targetRows[0].rol === 'admin_main' && req.user.rol !== 'admin_main') {
      return res.status(403).json({ message: 'Solo el Admin Main puede eliminar al Admin Main.' });
    }

    const { rows } = await pool.query(
      `UPDATE usuarios SET activo = FALSE
         WHERE id = $1 AND activo = TRUE
         RETURNING id`,
      [targetId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json({ message: 'Empleado eliminado.' });
  } catch (err) {
    console.error('deleteEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
