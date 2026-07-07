import pool from '../db/pool.js';

// ── GET /sucursales ─────────────────────────────────────────
// Catálogo de sucursales activas, usado por el selector del admin
// y por el formulario de empleados.
export const getSucursales = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT slug, nombre FROM sucursales WHERE activa = TRUE ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getSucursales error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
