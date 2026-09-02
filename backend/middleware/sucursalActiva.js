import pool from '../db/pool.js';
import { esAdmin } from './roles.js';

// Sucursal oculta donde operan los usuarios de prueba (migración 095). Sus
// notas, caja e inventario viven aquí y no se mezclan con los datos reales.
export const SUCURSAL_PRUEBAS = 'pruebas';

// Catálogo de slugs elegibles (sucursales activas y NO ocultas), cacheado.
// Se invalida con refrescarSlugsSucursales() al crear/activar/desactivar.
let slugsCache = null;
async function slugsValidos() {
  if (!slugsCache) {
    const { rows } = await pool.query('SELECT slug FROM sucursales WHERE activa = TRUE AND oculta = FALSE');
    slugsCache = new Set(rows.map((r) => r.slug));
  }
  return slugsCache;
}

// Fuerza recargar el cache en la próxima petición. Llamar tras mutar el
// catálogo de sucursales (crear/activar/desactivar).
export function refrescarSlugsSucursales() {
  slugsCache = null;
}

// Resuelve la sucursal activa de la petición en req.sucursal.
//   - Usuario de prueba: SIEMPRE la sucursal de pruebas, sin importar su rol
//     ni lo que mande el cliente. Es un entorno cerrado: no puede salir a una
//     sucursal real, igual que nadie más puede entrar a la suya.
//   - Admin: puede operar cualquier sucursal elegible enviándola en el header
//     'X-Sucursal' (o ?sucursal=); si no manda una válida, usa la suya. Las
//     ocultas no son elegibles, así que la de pruebas nunca le toca.
//   - Empleado: siempre su sucursal asignada, ignora lo que mande el cliente.
// Debe montarse después de verifyToken (necesita req.user).
export const sucursalActiva = async (req, res, next) => {
  try {
    if (req.user?.es_prueba) {
      req.sucursal = SUCURSAL_PRUEBAS;
      return next();
    }

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

// Bloquea a los usuarios de prueba en las acciones GLOBALES, las que no
// pertenecen a una sucursal y afectarían al negocio real: ajustes (tarifas,
// tiempos, datos del ticket), catálogo de sucursales y alta/edición de
// usuarios. Su entorno es de solo lectura hacia afuera: pueden operar todo lo
// suyo, pero no cambiar lo que comparten todas las sucursales.
export const bloquearPruebaGlobal = (req, res, next) => {
  if (req.user?.es_prueba) {
    return res.status(403).json({
      message: 'Los usuarios de prueba no pueden modificar la configuración del negocio.',
    });
  }
  next();
};
