import pool from '../db/pool.js';

// ── GET /sucursales ─────────────────────────────────────────
// Catálogo de sucursales activas, usado por el selector del admin,
// el formulario de empleados y la sección "Información de sucursales".
export const getSucursales = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT slug, nombre, direccion, telefono FROM sucursales WHERE activa = TRUE ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getSucursales error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── PATCH /sucursales/:slug ─────────────────────────────────
// Actualiza el nombre, dirección y teléfono de una sucursal (admin).
export const updateSucursal = async (req, res) => {
  const { slug } = req.params;
  const { nombre, direccion, telefono } = req.body;

  if (nombre !== undefined && !String(nombre).trim()) {
    return res.status(400).json({ message: 'El nombre de la sucursal no puede estar vacío.' });
  }

  const updates = [];
  const values  = [];
  let i = 1;

  if (nombre    !== undefined) { updates.push(`nombre = $${i++}`);    values.push(String(nombre).trim()); }
  if (direccion !== undefined) { updates.push(`direccion = $${i++}`); values.push(direccion || null); }
  if (telefono  !== undefined) { updates.push(`telefono = $${i++}`);  values.push(telefono || null); }

  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay campos para actualizar.' });
  }
  values.push(slug);

  try {
    const { rows } = await pool.query(
      `UPDATE sucursales SET ${updates.join(', ')}
         WHERE slug = $${i}
         RETURNING slug, nombre, direccion, telefono`,
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
