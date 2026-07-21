const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

// Sucursal activa: para un admin determina qué sucursal está administrando.
// El backend la respeta vía el header X-Sucursal (a los empleados los fuerza
// a la suya, ignorando este header).
function getSucursal() {
  return localStorage.getItem('sucursalActiva');
}

// Explicación breve por código de estado, para cuando el backend no manda
// un mensaje propio (o la respuesta ni siquiera es JSON, como los errores
// del proxy de Netlify o del rate limiter).
const DESCRIPCION_ERROR = {
  400: 'los datos enviados son inválidos o están incompletos',
  403: 'no tienes permiso para realizar esta acción',
  404: 'no se encontró la información solicitada',
  409: 'la operación no es válida con el estado actual de los datos',
  413: 'el archivo o los datos enviados son demasiado grandes',
  429: 'demasiados intentos seguidos, espera un momento y vuelve a intentar',
  500: 'ocurrió un problema interno en el servidor',
  502: 'el servidor no está respondiendo',
  503: 'el servidor no está disponible por el momento',
  504: 'el servidor tardó demasiado en responder',
};

export function mensajeDeError(status, data) {
  if (data?.message) return data.message;
  const detalle = DESCRIPCION_ERROR[status] || 'ocurrió un error en la solicitud';
  return `Error ${status}: ${detalle}.`;
}

async function request(path, options = {}) {
  const token = getToken();
  const sucursal = getSucursal();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(sucursal ? { 'X-Sucursal': sucursal } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }

  if (res.status === 401) {
    // Se intenta recuperar el motivo que manda el backend para avisarle al
    // usuario por qué se cerró su sesión (p. ej. inició sesión en otro
    // dispositivo). Se guarda en sessionStorage para que la pantalla de login
    // lo muestre tras la redirección.
    let motivo = null;
    try {
      const body = await res.json();
      motivo = body?.message || null;
    } catch {
      // Respuesta sin JSON: sin motivo específico.
    }
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    if (motivo) sessionStorage.setItem('authAviso', motivo);
    window.location.href = '/login';
    return;
  }

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Respuesta sin JSON (p. ej. página de error HTML del proxy).
  }
  if (!res.ok) throw new Error(mensajeDeError(res.status, data));
  return data;
}

export const api = {
  get:    (path)       => request(path),
  post:   (path, body) => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body) => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body) => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)       => request(path, { method: 'DELETE' }),
};
