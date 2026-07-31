import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

// ── GET /auth/buscar-usuarios?q=... ─────────────────────────
// Endpoint público usado por la pantalla de login para autocompletar
// el nombre del empleado. Devuelve solo id + nombre, máximo 8 resultados.
export const buscarUsuarios = async (req, res) => {
  const raw = (req.query.q ?? '').trim();
  if (!raw) return res.json([]);

  // El prefijo *** revela los usuarios ocultos: el admin_main y los usuarios
  // de prueba. Sin él, esos usuarios no aparecen en la búsqueda normal.
  const mostrarOcultos = raw.startsWith('***');
  const q = mostrarOcultos ? raw.slice(3).trim() : raw;

  // Mínimo 2 caracteres (también tras el prefijo ***) para dificultar la
  // enumeración de empleados; con menos, no se listan resultados.
  if (q.length < 2) return res.json([]);

  const sql = mostrarOcultos
    ? `SELECT id, nombre FROM usuarios
        WHERE activo = TRUE AND (rol = 'admin_main' OR es_prueba = TRUE)
          AND unaccent(nombre) ILIKE unaccent($1)
        ORDER BY nombre ASC
        LIMIT 8`
    : `SELECT id, nombre FROM usuarios
        WHERE activo = TRUE AND rol <> 'admin_main' AND es_prueba = FALSE
          AND unaccent(nombre) ILIKE unaccent($1)
        ORDER BY nombre ASC
        LIMIT 8`;
  const params = [`%${q}%`];

  try {
    const { rows } = await pool.query(sql, params);
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
      `SELECT id, nombre, password, rol, sucursal, es_prueba FROM usuarios WHERE id = $1 AND activo = TRUE`,
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

    // Sesión única por cuenta: se genera un id de sesión nuevo en cada login y
    // se guarda en el usuario. El token lo lleva en "sid"; verifyToken exige que
    // coincida, así que iniciar sesión aquí invalida cualquier sesión previa en
    // otro dispositivo.
    const sessionId = randomUUID();
    await pool.query('UPDATE usuarios SET session_id = $1 WHERE id = $2', [sessionId, usuario.id]);

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol, sucursal: usuario.sucursal, sid: sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        sucursal: usuario.sucursal,
        es_prueba: usuario.es_prueba,
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
      'SELECT id, nombre, rol, sucursal, es_prueba FROM usuarios WHERE id = $1 AND activo = TRUE',
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
    if (password.length < 8) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
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
