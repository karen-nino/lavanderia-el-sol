import pool from '../db/pool.js';
import { esAdmin } from './roles.js';

// Catálogo de slugs válidos, cacheado (las sucursales cambian rara vez).
let slugsCache = null;
async function slugsValidos() {
  if (!slugsCache) {
    const { rows } = await pool.query('SELECT slug FROM sucursales WHERE activa = TRUE');
    slugsCache = new Set(rows.map((r) => r.slug));
  }
  return slugsCache;
}

// Resuelve la sucursal activa de la petición en req.sucursal.
//   - Admin: puede operar cualquier sucursal enviándola en el header
//     'X-Sucursal' (o ?sucursal=); si no manda una válida, usa la suya.
//   - Empleado: siempre su sucursal asignada, ignora lo que mande el cliente.
// Debe montarse después de verifyToken (necesita req.user).
export const sucursalActiva = async (req, res, next) => {
  try {
    const propia = req.user?.sucursal || 'lopez_cotilla';
    let activa = propia;

    if (esAdmin(req.user?.rol)) {
      const pedida = req.headers['x-sucursal'] || req.query.sucursal;
      if (pedida && (await slugsValidos()).has(pedida)) {
        activa = pedida;
      }
    }

    req.sucursal = activa;
    next();
  } catch (err) {
    console.error('sucursalActiva error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
