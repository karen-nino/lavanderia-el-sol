/**
 * Cómo se entera la app instalada de una versión nueva. Instalada casi nunca se
 * recarga y el service worker no sirve para detectarlo (sw.js no cambia entre
 * despliegues), así que el build publica version.json y se compara con la
 * versión del bundle.
 */
import { APP_VERSION } from './version';

/** Versión recién publicada; siempre de la red (`no-store`). */
const URL_VERSION = '/version.json';

/**
 * ¿La versión publicada es otra? Por igualdad, no por "mayor que": revertir a
 * una anterior también es un cambio.
 */
export function hayQueActualizar(publicada, actual = APP_VERSION) {
  if (typeof publicada !== 'string') return false;
  const v = publicada.trim();
  if (!v) return false;
  // 'dev': el bundle no lleva versión inyectada (lib/version.js).
  if (actual === 'dev') return false;
  return v !== actual;
}

/**
 * Compara dos versiones "1.2.3" número por número: negativo si `a` es anterior,
 * 0 si son iguales, positivo si es posterior.
 */
export function compararVersiones(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * ¿Esta versión ya no sirve? Pasa cuando el servidor publica una `minima`
 * (versionMinima de package.json) posterior a la que corre.
 */
export function esObligatoria(minima, actual = APP_VERSION) {
  if (typeof minima !== 'string' || !minima.trim()) return false;
  if (actual === 'dev') return false;
  return compararVersiones(actual, minima.trim()) < 0;
}

/** Versión publicada y la mínima que se acepta, o null si no se pudo saber. Nunca lanza. */
export async function infoPublicada() {
  try {
    const res = await fetch(URL_VERSION, { cache: 'no-store' });
    if (!res.ok) return null;
    const datos = await res.json();
    if (typeof datos?.version !== 'string') return null;
    return { version: datos.version, minima: typeof datos.minima === 'string' ? datos.minima : null };
  } catch {
    return null;
  }
}

/** Versión publicada, o null si no se pudo saber. Nunca lanza. */
export async function versionPublicada() {
  return (await infoPublicada())?.version ?? null;
}

/*
 * Pantallas de consulta: ahí se puede recargar sola al volver a la app o tras
 * un rato sin tocarla. Fuera quedan las de captura (Nueva nota, Ajustes, Caja…).
 */
const RUTAS_CONSULTA = [
  /^\/$/,
  /^\/notas\/?$/,
  /^\/notas\/\d+\/?$/,
  /^\/notas\/\d+\/salidas\/?$/,
  /^\/maquinas\/?$/,
  /^\/inventario\/?$/,
  /^\/manual\/?$/,
];

/** ¿La ruta es de consulta (sin nada que capturar)? */
export function esRutaDeConsulta(ruta) {
  return RUTAS_CONSULTA.some(r => r.test(ruta));
}

/**
 * ¿Se puede recargar sin perder nada? No, con un modal abierto (todos son
 * `fixed inset-0`) o escribiendo en un campo.
 */
export function esMomentoSeguro(doc = document) {
  if (doc.querySelector('.fixed.inset-0')) return false;
  const activo = doc.activeElement;
  return !(activo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activo.tagName));
}

/**
 * Trae la versión nueva: da de baja el service worker (en iPhone, recargar con
 * el viejo dejaba la página en blanco), borra sus cachés y recarga. main.jsx lo
 * vuelve a registrar.
 */
export async function aplicarActualizacion() {
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map(r => r.unregister()));
    }
  } catch {
    // Sin permiso para tocarlo: se sigue con las cachés y la recarga.
  }
  try {
    if ('caches' in window) {
      const claves = await caches.keys();
      await Promise.all(
        claves.filter(c => c.startsWith('el-sol-')).map(c => caches.delete(c))
      );
    }
  } catch {
    // Sin cachés que borrar (modo privado, permisos): la recarga basta.
  }
  window.location.reload();
}
