import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// ── GET /auth/buscar-usuarios?q=... ─────────────────────────
// Endpoint público usado por la pantalla de login para autocompletar
// el nombre del empleado. Devuelve solo id + nombre, máximo 8 resultados.
export const buscarUsuarios = async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return res.json([]);

  try {
    const { rows } = await pool.query(
      `SELECT id, nombre FROM usuarios
        WHERE activo = TRUE AND nombre ILIKE $1
        ORDER BY nombre ASC
        LIMIT 8`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error('buscarUsuarios error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const login = async (req, res) => {
  const { usuario_id, password } = req.body;
  const userId = Number(usuario_id);

  if (!userId || !password) {
    return res.status(400).json({ message: 'Usuario y contraseña son requeridos.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, password, rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [userId]
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
      { id: usuario.id, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
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
      'SELECT id, nombre, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
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
  const { nombre, password } = req.body;
  const updates = [];
  const values  = [];
  let i = 1;

  if (nombre !== undefined) {
    if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
    updates.push(`nombre = $${i++}`); values.push(nombre.trim());
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
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${i} AND activo = TRUE RETURNING id, nombre, rol`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateMe error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
