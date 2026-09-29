// Cómo se entera la app instalada de que hay una versión nueva.
//
// El problema que resuelve: una vez instalada en el teléfono, la app casi nunca
// se recarga. El empleado la abre y el sistema le devuelve la ventana tal como
// la dejó, sin volver a pedir el index.html, así que el JavaScript que corre
// puede ser el de hace semanas aunque el servidor ya tenga otro. Como no hay
// recarga, no hay nada que avise: la app se queda anclada a su versión.
//
// Tampoco sirve apoyarse en el service worker para detectarlo: el navegador
// solo lo considera "nuevo" si el archivo sw.js cambió de contenido, y el
// nuestro es el mismo en cada despliegue (ver public/sw.js). Se publica la
// versión entonces en un archivo suelto —version.json, que el build genera— y
// se compara con la que trae el bundle que está corriendo.
import { APP_VERSION } from './version';

// El archivo que el build deja con la versión recién publicada. Se pide siempre
// a la red (`no-store`): preguntarle a la caché qué versión hay en el servidor
// no tendría sentido.
const URL_VERSION = '/version.json';

// ¿La versión publicada es otra que la que corre aquí? Se compara por igualdad,
// no por "mayor que": un despliegue que revierte a la versión anterior también
// es un cambio que el teléfono tiene que recoger.
export function hayQueActualizar(publicada, actual = APP_VERSION) {
  if (typeof publicada !== 'string') return false;
  const v = publicada.trim();
  if (!v) return false;
  // 'dev' es el valor de APP_VERSION cuando el bundle no lleva versión
  // inyectada (ver lib/version.js). Ahí no hay nada que comparar.
  if (actual === 'dev') return false;
  return v !== actual;
}

// Versión publicada ahora mismo, o null si no se pudo averiguar (sin red, o el
// archivo todavía no existe en ese despliegue). Nunca lanza: no saberlo no es
// un error que el login tenga que enseñar.
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

// Trae la versión nueva. Borra las cachés del service worker —ahí viven el
// index.html y los archivos del build anterior— y recarga: al volver a pedir la
// página, el HTML nuevo apunta a los archivos nuevos y el teléfono los baja.
export async function aplicarActualizacion() {
  try {
    if ('caches' in window) {
      const claves = await caches.keys();
      await Promise.all(
        claves.filter(c => c.startsWith('el-sol-')).map(c => caches.delete(c))
      );
    }
  } catch {
    // Sin cachés que borrar (modo privado, permisos): la recarga sigue siendo
    // lo que trae la versión nueva.
  }
  window.location.reload();
}
