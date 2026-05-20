import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export const login = async (req, res) => {
  const { telefono, password } = req.body;
  const digitos = (telefono ?? '').replace(/\D/g, '');

  if (!digitos || !password) {
    return res.status(400).json({ message: 'Teléfono y contraseña son requeridos.' });
  }
  if (digitos.length !== 10) {
    return res.status(400).json({ message: 'El teléfono debe tener 10 dígitos.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM usuarios
       WHERE regexp_replace(COALESCE(telefono, ''), '\\D', '', 'g') = $1
         AND activo = TRUE`,
      [digitos]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const usuario = rows[0];
    const valid = await bcrypt.compare(password, usuario.password);

    if (!valid) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        telefono: usuario.telefono,
        rol: usuario.rol,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /auth/me ─────────────────────────────────────────────
export const getMe = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, telefono, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /auth/me ───────────────────────────────────────────
export const updateMe = async (req, res) => {
  const { nombre, email, telefono, password } = req.body;
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
    updates.push(`telefono = $${i++}`); values.push(telefono.trim() || null);
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
  updates.push('updated_at = NOW()');
  values.push(req.user.id);

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${i} AND activo = TRUE RETURNING id, nombre, email, telefono, rol`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const campo = err.constraint === 'usuarios_telefono_key' ? 'teléfono' : 'email';
      return res.status(409).json({ message: `El ${campo} ya está en uso.` });
    }
    console.error('updateMe error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
