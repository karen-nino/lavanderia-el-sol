import pool from '../db/pool.js';
import { esAdmin } from './roles.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';

/** Sucursal oculta de los usuarios de prueba: sus datos no se mezclan con los reales. */
export const SUCURSAL_PRUEBAS = 'pruebas';

/** Caché de slugs elegibles (activas y no ocultas); se invalida con refrescarSlugsSucursales. */
let slugsCache = null;
async function slugsValidos({ recargar = false } = {}) {
  if (!slugsCache || recargar) {
    const { rows } = await pool.query('SELECT slug FROM sucursales WHERE activa = TRUE AND oculta = FALSE');
    slugsCache = new Set(rows.map((r) => r.slug));
  }
  return slugsCache;
}

/** ¿Slug elegible? Si el caché no lo conoce, se recarga una vez (sucursal recién creada). */
async function esSlugElegible(slug) {
  if ((await slugsValidos()).has(slug)) return true;
  return (await slugsValidos({ recargar: true })).has(slug);
}

/** Recarga el caché en la próxima petición; llamar tras cambiar el catálogo de sucursales. */
export function refrescarSlugsSucursales() {
  slugsCache = null;
}

/** Slugs renombrados: una tablet con versión vieja puede seguir mandando el anterior. */
const SLUGS_RENOMBRADOS = { lopez_cotilla: 'zapopan' };
export const slugVigente = (slug) => SLUGS_RENOMBRADOS[slug] ?? slug;

/**
 * Pone en `req.sucursal` la sucursal activa (montar después de verifyToken):
 * - usuario de prueba: siempre la de pruebas;
 * - admin: la elegible que mande en 'X-Sucursal' (o ?sucursal=), o la suya;
 * - empleado: siempre la suya.
 */
export const sucursalActiva = async (req, res, next) => {
  try {
    if (req.user?.es_prueba) {
      req.sucursal = SUCURSAL_PRUEBAS;
      return next();
    }

    const propia = req.user?.sucursal || 'zapopan';
    let activa = propia;

    if (esAdmin(req.user?.rol)) {
      const pedida = slugVigente(req.headers['x-sucursal'] || req.query.sucursal);
      if (pedida && (await esSlugElegible(pedida))) {
        activa = pedida;
      }
    }

    req.sucursal = activa;
    next();
  } catch (err) {
    console.error('sucursalActiva error:', err);
    res.status(500).json({ message: 'No se pudo identificar la sucursal. Intenta de nuevo.' });
  }
};

/**
 * Bloquea a los usuarios de prueba en lo global (Ajustes, sucursales, usuarios):
 * operan lo suyo pero no cambian lo compartido. En la demo no aplica.
 */
export const bloquearPruebaGlobal = (req, res, next) => {
  if (req.user?.es_prueba && !ENTORNO_DEMO) {
    return res.status(403).json({
      message: 'Los usuarios de prueba no pueden modificar la configuración del negocio.',
    });
  }
  next();
};
