import pool from '../db/pool.js';
import { refrescarSlugsSucursales } from '../middleware/sucursalActiva.js';

// Convierte un nombre en un slug seguro: sin acentos, minúsculas y
// separando con guión bajo. Ej: "Sucursal Centro Histórico" → "centro_historico".
function slugify(str) {
  return String(str)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ── GET /sucursales ─────────────────────────────────────────
// Por defecto solo activas (para el selector del header y el form de
// empleados). Con ?todas=1 incluye las inactivas (gestión en Ajustes).
export const getSucursales = async (req, res) => {
  const todas = req.query.todas === '1' || req.query.todas === 'true';
  try {
    const { rows } = await pool.query(
      `SELECT slug, nombre, direccion, telefono, activa, orden
         FROM sucursales
        ${todas ? '' : 'WHERE activa = TRUE'}
        ORDER BY activa DESC, orden ASC, nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getSucursales error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /sucursales/reordenar ─────────────────────────────
// Reordena las sucursales: recibe { slugs: [...] } en el nuevo orden y asigna
// orden = posición. En una transacción para que quede consistente.
export const reordenarSucursales = async (req, res) => {
  const slugs = Array.isArray(req.body.slugs)
    ? req.body.slugs.map(String).filter(Boolean)
    : [];
  if (slugs.length === 0) {
    return res.status(400).json({ message: 'Se requiere la lista de slugs en orden.' });
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
      `SELECT slug, nombre, direccion, telefono, activa, orden
         FROM sucursales
        ORDER BY activa DESC, orden ASC, nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reordenarSucursales error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── POST /sucursales ────────────────────────────────────────
// Crea una sucursal (admin). El slug se genera desde el nombre y se
// hace único agregando un sufijo si ya existe.
export const createSucursal = async (req, res) => {
  const { nombre, direccion, telefono } = req.body;

  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ message: 'El nombre de la sucursal es requerido.' });
  }

  const base = slugify(nombre) || 'sucursal';
  try {
    // Buscar un slug libre: base, base_2, base_3, ...
    const { rows: existentes } = await pool.query(
      "SELECT slug FROM sucursales WHERE slug = $1 OR slug LIKE $2",
      [base, `${base}_%`]
    );
    const usados = new Set(existentes.map((r) => r.slug));
    let slug = base;
    let n = 2;
    while (usados.has(slug)) slug = `${base}_${n++}`;

    const { rows } = await pool.query(
      `INSERT INTO sucursales (slug, nombre, direccion, telefono, activa)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING slug, nombre, direccion, telefono, activa`,
      [slug, String(nombre).trim(), direccion || null, telefono || null]
    );
    refrescarSlugsSucursales();
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createSucursal error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /sucursales/:slug ─────────────────────────────────
// Actualiza el nombre, dirección y teléfono de una sucursal (admin).
export const updateSucursal = async (req, res) => {
  const { slug } = req.params;
  const { nombre, direccion, telefono, orden } = req.body;

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
  if (orden     !== undefined) { updates.push(`orden = $${i++}`);     values.push(Number(orden)); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay campos para actualizar.' });
  }
  values.push(slug);

  try {
    const { rows } = await pool.query(
      `UPDATE sucursales SET ${updates.join(', ')}
         WHERE slug = $${i}
         RETURNING slug, nombre, direccion, telefono, activa, orden`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Sucursal no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateSucursal error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /sucursales/:slug/activa ──────────────────────────
// Activa o desactiva una sucursal (admin). "Eliminar" = desactivar: la
// sucursal desaparece de la operación pero su historial se conserva.
// No se permite desactivar la última sucursal activa.
export const setActivaSucursal = async (req, res) => {
  const { slug } = req.params;
  const { activa } = req.body;

  if (typeof activa !== 'boolean') {
    return res.status(400).json({ message: 'El campo "activa" (true/false) es requerido.' });
  }

  try {
    const { rows: existe } = await pool.query('SELECT activa FROM sucursales WHERE slug = $1', [slug]);
    if (existe.length === 0) {
      return res.status(404).json({ message: 'Sucursal no encontrada.' });
    }

    if (activa === false) {
      const { rows: act } = await pool.query('SELECT COUNT(*)::int AS n FROM sucursales WHERE activa = TRUE');
      if (act[0].n <= 1) {
        return res.status(400).json({ message: 'No puedes desactivar la última sucursal activa.' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE sucursales SET activa = $1 WHERE slug = $2
         RETURNING slug, nombre, direccion, telefono, activa`,
      [activa, slug]
    );
    refrescarSlugsSucursales();
    res.json(rows[0]);
  } catch (err) {
    console.error('setActivaSucursal error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
