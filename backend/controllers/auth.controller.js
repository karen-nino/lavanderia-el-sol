import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { capitalizarNombre } from '../utils/nombres.js';
import { fechaLocal } from '../utils/tz.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';
import { esAdmin } from '../middleware/roles.js';

// ── GET /auth/buscar-usuarios?q=... ─────────────────────────
// Autocompletado público del login: id + nombre, máximo 5. Acotado para que no
// sirva de directorio de personal: mínimo 3 caracteres, solo coincide por el
// inicio del nombre o de una palabra, escapa los comodines de ILIKE y la ruta
// tiene límites por IP (por minuto y por hora).

/** true: los usuarios de prueba salen en la búsqueda normal, sin el prefijo ***. */
const PRUEBA_VISIBLE_EN_LOGIN = true;

export const buscarUsuarios = async (req, res) => {
  const raw = (req.query.q ?? '').trim();
  if (!raw) return res.json([]);

  // El prefijo *** muestra los ocultos (admin_main y, si no son visibles, los de prueba).
  const mostrarOcultos = raw.startsWith('***');
  const q = mostrarOcultos ? raw.slice(3).trim() : raw;

  // Mínimo 3 caracteres, también después del prefijo.
  if (q.length < 3) return res.json([]);

  // Escapa los comodines de ILIKE (`%`, `_`, `\`).
  const termino = q.replace(/[\\%_]/g, (c) => '\\' + c);

  const nombreCompleto = "TRIM(nombre || ' ' || COALESCE(apellido, ''))";
  // $1: empieza el nombre; $2: empieza otra palabra (apellido, segundo nombre).
  const coincide = `(unaccent(${nombreCompleto}) ILIKE unaccent($1)
                  OR unaccent(${nombreCompleto}) ILIKE unaccent($2))`;
  const sql = mostrarOcultos
    ? `SELECT id, ${nombreCompleto} AS nombre FROM usuarios
        WHERE activo = TRUE AND (rol = 'admin_main' OR es_prueba = TRUE)
          AND ${coincide}
        ORDER BY nombre ASC
        LIMIT 5`
    : `SELECT id, ${nombreCompleto} AS nombre FROM usuarios
        WHERE activo = TRUE AND rol <> 'admin_main'
          AND (es_prueba = FALSE OR ${PRUEBA_VISIBLE_EN_LOGIN ? 'TRUE' : 'FALSE'})
          AND ${coincide}
        ORDER BY nombre ASC
        LIMIT 5`;
  const params = [`${termino}%`, `% ${termino}%`];

  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('buscarUsuarios error:', err);
    res.status(500).json({ message: 'No se pudo buscar el usuario. Intenta de nuevo.' });
  }
};

export const login = async (req, res) => {
  const { usuario_id, password } = req.body;
  const userId = Number(usuario_id);

  if (!userId || !password) {
    return res.status(400).json({ message: 'Escribe tu usuario y tu contraseña.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, password, rol, sucursal, es_prueba FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado.' });
    }

    const usuario = rows[0];
    const valid = await bcrypt.compare(password, usuario.password);

    if (!valid) {
      return res.status(401).json({ message: 'Contraseña incorrecta.' });
    }

    // Sesión única: cada login genera un session_id nuevo (el "sid" del token)
    // e invalida la sesión en otro dispositivo.
    const sessionId = randomUUID();
    await pool.query('UPDATE usuarios SET session_id = $1 WHERE id = $2', [sessionId, usuario.id]);

    // Check-in: el primer login del día local es la hora de entrada. No debe
    // bloquear el login, por eso va en su propio try/catch.
    try {
      await pool.query(
        `INSERT INTO checkins (usuario_id, fecha) VALUES ($1, $2)
           ON CONFLICT (usuario_id, fecha) DO NOTHING`,
        [usuario.id, fechaLocal()]
      );
    } catch (err) {
      console.error('checkin error:', err);
    }

    // 30 días: la sesión se cierra con el botón o al entrar en otro dispositivo.
    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol, sucursal: usuario.sucursal, sid: sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        sucursal: usuario.sucursal,
        es_prueba: usuario.es_prueba,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'No se pudo iniciar sesión. Intenta de nuevo.' });
  }
};

// ── POST /auth/demo-login ────────────────────────────────────
/**
 * Entrada sin contraseña, solo en la demo pública: la ruta solo se monta con
 * ENTORNO_DEMO, al arrancar se comprueba que la base no tenga operación real y
 * solo entra a usuarios con es_prueba. `rol` elige como quién se entra:
 * 'admin' (por defecto) u 'operador' (empleado).
 */
export const demoLogin = async (req, res) => {
  if (!ENTORNO_DEMO) return res.status(404).json({ message: 'No encontrado.' });

  const rol = req.body?.rol ?? 'admin';
  if (rol !== 'admin' && rol !== 'operador') {
    return res.status(400).json({ message: 'Rol de demostración no válido.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, rol, sucursal, es_prueba, session_id
         FROM usuarios
        WHERE es_prueba = TRUE AND activo = TRUE AND rol = $1
        ORDER BY id
        LIMIT 1`,
      [rol]
    );

    if (rows.length === 0) {
      return res.status(503).json({ message: 'La demo no tiene usuario de demostración.' });
    }

    const usuario = rows[0];

    // No se rota la sesión: todos los visitantes comparten la cuenta y el sid.
    const sessionId = usuario.session_id || randomUUID();
    if (!usuario.session_id) {
      await pool.query('UPDATE usuarios SET session_id = $1 WHERE id = $2', [sessionId, usuario.id]);
    }

    // Una hora, para que un token copiado no sirva por mucho tiempo.
    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol, sucursal: usuario.sucursal, sid: sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
        sucursal: usuario.sucursal,
        es_prueba: usuario.es_prueba,
      },
    });
  } catch (err) {
    console.error('demoLogin error:', err);
    res.status(500).json({ message: 'No se pudo entrar a la demo. Intenta de nuevo.' });
  }
};

// ── POST /auth/logout ────────────────────────────────────────
/**
 * Registra la salida del día en el check-in (queda la última). Nunca bloquea:
 * siempre responde 200.
 */
export const logout = async (req, res) => {
  try {
    await pool.query(
      `UPDATE checkins SET salida = NOW()
        WHERE usuario_id = $1 AND fecha = $2`,
      [req.user.id, fechaLocal()]
    );
  } catch (err) {
    console.error('logout (salida) error:', err);
  }
  res.json({ ok: true });
};

// ── GET /auth/me ─────────────────────────────────────────────
export const getMe = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, apellido, rol, sucursal, es_prueba FROM usuarios WHERE id = $1 AND activo = TRUE',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({ message: 'No se pudo cargar tu perfil. Intenta de nuevo.' });
  }
};

// ── PATCH /auth/me ───────────────────────────────────────────
export const updateMe = async (req, res) => {
  const { nombre, apellido, password } = req.body;
  const updates = [];
  const values  = [];
  let i = 1;

  /* El empleado solo cambia su contraseña; su nombre lo lleva un admin. */
  if (!esAdmin(req.user.rol) && (nombre !== undefined || apellido !== undefined)) {
    return res.status(403).json({ message: 'Tu nombre lo cambia un administrador.' });
  }

  if (nombre !== undefined) {
    if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
    updates.push(`nombre = $${i++}`); values.push(capitalizarNombre(nombre));
  }
  if (apellido !== undefined) {
    updates.push(`apellido = $${i++}`); values.push(capitalizarNombre(apellido) || null);
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    updates.push(`password = $${i++}`); values.push(hashed);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  updates.push('updated_at = NOW()');
  values.push(req.user.id);

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${i} AND activo = TRUE RETURNING id, nombre, apellido, rol`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateMe error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios de tu perfil. Intenta de nuevo.' });
  }
};
