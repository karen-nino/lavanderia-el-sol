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

/** Versión publicada, o null si no se pudo saber. Nunca lanza. */
export async function versionPublicada() {
  try {
    const res = await fetch(URL_VERSION, { cache: 'no-store' });
    if (!res.ok) return null;
    const datos = await res.json();
    return typeof datos?.version === 'string' ? datos.version : null;
  } catch {
    return null;
  }
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
