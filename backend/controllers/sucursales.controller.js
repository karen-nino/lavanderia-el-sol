import pool from '../db/pool.js';
import { refrescarSlugsSucursales, SUCURSAL_PRUEBAS } from '../middleware/sucursalActiva.js';

/** "Sucursal Centro Histórico" → "centro_historico" (sin acentos, minúsculas, guion bajo). */
function slugify(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── GET /sucursales ─────────────────────────────────────────
/** Sucursales activas (con ?todas=1, también las inactivas). Las ocultas nunca se listan. */
export const getSucursales = async (req, res) => {
  const todas = req.query.todas === '1' || req.query.todas === 'true';
  const esPrueba = req.user?.es_prueba === true;
  try {
    const filtros = [
      esPrueba ? 'slug = $1' : 'oculta = FALSE',
      todas ? null : 'activa = TRUE',
    ].filter(Boolean);
    const { rows } = await pool.query(
      `SELECT slug, nombre, direccion, telefono, horario_semana, activa, orden
         FROM sucursales
        WHERE ${filtros.join(' AND ')}
        ORDER BY activa DESC, orden ASC, nombre ASC`,
      esPrueba ? [SUCURSAL_PRUEBAS] : []
    );
    res.json(rows);
  } catch (err) {
    console.error('getSucursales error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las sucursales. Intenta de nuevo.' });
  }
};

// ── PATCH /sucursales/reordenar ─────────────────────────────
/** Reordena las sucursales: { slugs } en el nuevo orden, en una transacción. */
export const reordenarSucursales = async (req, res) => {
  const slugs = Array.isArray(req.body.slugs)
    ? req.body.slugs.map(String).filter(Boolean)
    : [];
  if (slugs.length === 0) {
    return res.status(400).json({ message: 'No llegó el nuevo orden de las sucursales. Intenta de nuevo.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < slugs.length; i++) {
      await client.query(
        'UPDATE sucursales SET orden = $1 WHERE slug = $2',
        [i + 1, slugs[i]]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT slug, nombre, direccion, telefono, horario_semana, activa, orden
         FROM sucursales
        WHERE oculta = FALSE
        ORDER BY activa DESC, orden ASC, nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reordenarSucursales error:', err);
    res.status(500).json({ message: 'No se pudo guardar el nuevo orden de las sucursales. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// Horario por día: 7 días, de lunes (0) a domingo (6), abierto o cerrado, con
// hora de abrir y cerrar ("HH:MM", 24 h).
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function leerHorarioSemana(h) {
  if (h === undefined) return { valor: undefined };
  if (h === null) return { valor: null };
  if (!Array.isArray(h) || h.length !== 7) return { error: 'El horario debe traer los 7 días.' };
  const dias = [];
  for (let d = 0; d < 7; d++) {
    const x = h.find(r => Number(r?.dia) === d);
    if (!x) return { error: 'El horario debe traer los 7 días.' };
    const abierto = x.abierto === true;
    if (abierto) {
      if (!HORA_RE.test(String(x.abre)) || !HORA_RE.test(String(x.cierra))) {
        return { error: `Pon la hora de abrir y de cerrar del ${DIAS[d]}.` };
      }
      if (String(x.cierra) <= String(x.abre)) {
        return { error: `El ${DIAS[d]} la hora de cerrar tiene que ser después de la de abrir.` };
      }
    }
    dias.push({ dia: d, abierto, abre: abierto ? x.abre : null, cierra: abierto ? x.cierra : null });
  }
  return { valor: JSON.stringify(dias) };
}

// ── POST /sucursales ────────────────────────────────────────
/** Crea una sucursal (admin), con un slug único derivado del nombre. */
export const createSucursal = async (req, res) => {
  const { nombre, direccion, telefono, horario_semana } = req.body;

  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ message: 'El nombre de la sucursal es requerido.' });
  }
  const horario = leerHorarioSemana(horario_semana);
  if (horario.error) return res.status(400).json({ message: horario.error });

  const base = slugify(nombre) || 'sucursal';
  try {
    // Slug libre: base, base_2, base_3…
    const { rows: existentes } = await pool.query(
      "SELECT slug FROM sucursales WHERE slug = $1 OR slug LIKE $2",
      [base, `${base}_%`]
    );
    const usados = new Set(existentes.map((r) => r.slug));
    let slug = base;
    let n = 2;
    while (usados.has(slug)) slug = `${base}_${n++}`;

    const { rows } = await pool.query(
      `INSERT INTO sucursales (slug, nombre, direccion, telefono, horario_semana, activa)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING slug, nombre, direccion, telefono, horario_semana, activa`,
      [slug, String(nombre).trim(), direccion || null, telefono || null,
       horario.valor === undefined ? null : horario.valor]
    );
    refrescarSlugsSucursales();
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createSucursal error:', err);
    res.status(500).json({ message: 'No se pudo crear la sucursal. Intenta de nuevo.' });
  }
};

// ── PATCH /sucursales/:slug ─────────────────────────────────
/** Edita nombre, dirección, teléfono y horario de una sucursal (admin). */
export const updateSucursal = async (req, res) => {
  const { slug } = req.params;
  const { nombre, direccion, telefono, horario_semana, orden } = req.body;
  const horario = leerHorarioSemana(horario_semana);
  if (horario.error) return res.status(400).json({ message: horario.error });

  // La sucursal de pruebas no se administra desde la app.
  if (slug === SUCURSAL_PRUEBAS) {
    return res.status(404).json({ message: 'Sucursal no encontrada.' });
  }

  if (nombre !== undefined && !String(nombre).trim()) {
    return res.status(400).json({ message: 'El nombre de la sucursal no puede estar vacío.' });
  }
  if (orden !== undefined && !Number.isInteger(Number(orden))) {
    return res.status(400).json({ message: 'El orden debe ser un número entero.' });
  }

  const updates = [];
  const values  = [];
  let i = 1;

  if (nombre    !== undefined) { updates.push(`nombre = $${i++}`);    values.push(String(nombre).trim()); }
  if (direccion !== undefined) { updates.push(`direccion = $${i++}`); values.push(direccion || null); }
  if (telefono  !== undefined) { updates.push(`telefono = $${i++}`);  values.push(telefono || null); }
  if (horario.valor !== undefined) { updates.push(`horario_semana = $${i++}`); values.push(horario.valor); }
  if (orden     !== undefined) { updates.push(`orden = $${i++}`);     values.push(Number(orden)); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  values.push(slug);

  try {
    const { rows } = await pool.query(
      `UPDATE sucursales SET ${updates.join(', ')}
         WHERE slug = $${i}
         RETURNING slug, nombre, direccion, telefono, horario_semana, activa, orden`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Sucursal no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateSucursal error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios de la sucursal. Intenta de nuevo.' });
  }
};

// ── PATCH /sucursales/:slug/activa ──────────────────────────
/**
 * Activa o desactiva una sucursal (admin); "eliminar" es desactivar y conserva
 * su historial. No se desactiva la última sucursal real activa.
 */
export const setActivaSucursal = async (req, res) => {
  const { slug } = req.params;
  const { activa } = req.body;

  if (typeof activa !== 'boolean') {
    return res.status(400).json({ message: 'Indica si la sucursal queda activa o inactiva.' });
  }

  if (slug === SUCURSAL_PRUEBAS) {
    return res.status(404).json({ message: 'Sucursal no encontrada.' });
  }

  try {
    const { rows: existe } = await pool.query('SELECT activa FROM sucursales WHERE slug = $1', [slug]);
    if (existe.length === 0) {
      return res.status(404).json({ message: 'Sucursal no encontrada.' });
    }

    if (activa === false) {
      // La de pruebas no cuenta como sucursal activa.
      const { rows: act } = await pool.query('SELECT COUNT(*)::int AS n FROM sucursales WHERE activa = TRUE AND oculta = FALSE');
      if (act[0].n <= 1) {
        return res.status(400).json({ message: 'No puedes desactivar la última sucursal activa.' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE sucursales SET activa = $1 WHERE slug = $2
         RETURNING slug, nombre, direccion, telefono, horario_semana, activa`,
      [activa, slug]
    );
    refrescarSlugsSucursales();
    res.json(rows[0]);
  } catch (err) {
    console.error('setActivaSucursal error:', err);
    res.status(500).json({ message: 'No se pudo cambiar el estado de la sucursal. Intenta de nuevo.' });
  }
};
