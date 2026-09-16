import { ES_DEMO } from './entorno';

// Dónde vive la sesión: el token, el usuario y la sucursal activa.
//
// Fuera de la demo, en localStorage. En el mostrador la app se usa como si
// estuviera instalada y la sesión dura 30 días a propósito: cerrar la pestaña
// —o que se apague el teléfono— no debe echar a nadie, para eso está el botón
// de Salir.
//
// En la DEMO, en sessionStorage. Ese almacén es de la pestaña y el navegador lo
// tira al cerrarla, así que quien abra la demo siempre empieza en la pantalla
// de entrada en vez de encontrarse dentro con la sesión del visitante anterior.
// Tampoco se comparte entre pestañas: cada una entra por su cuenta, que en una
// demo donde todos usan la misma cuenta da igual.
export const almacenSesion = ES_DEMO ? window.sessionStorage : window.localStorage;

// Restos de una visita anterior, de cuando la demo también guardaba en
// localStorage: si no se limpian se quedan ahí para siempre, porque ya nadie
// los lee.
if (ES_DEMO) {
  for (const clave of ['token', 'usuario', 'sucursalActiva']) {
    try { window.localStorage.removeItem(clave); } catch { /* modo privado */ }
  }
}
