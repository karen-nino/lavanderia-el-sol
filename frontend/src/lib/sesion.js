import { ES_DEMO } from './entorno';

/**
 * Dónde vive la sesión (token, usuario y sucursal). Normalmente en
 * localStorage: dura 30 días y no se pierde al cerrar la pestaña. En la demo, en
 * sessionStorage: cada visita empieza en el login.
 */
export const almacenSesion = ES_DEMO ? window.sessionStorage : window.localStorage;

// Restos de visitas que guardaban en localStorage.
if (ES_DEMO) {
  for (const clave of ['token', 'usuario', 'sucursalActiva']) {
    try { window.localStorage.removeItem(clave); } catch { /* modo privado */ }
  }
}
