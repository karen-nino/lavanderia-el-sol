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

// Explicación por código de estado, para cuando el backend no manda un
// mensaje propio (o la respuesta ni siquiera es JSON, como los errores del
// proxy de Netlify o del rate limiter). Se escribe como se lo diríamos a
// quien está en el mostrador; el número queda al final por si hay que
// reportarlo, pero la frase se entiende sin él.
const DESCRIPCION_ERROR = {
  400: 'Revisa los datos: falta algo o quedó mal escrito.',
  403: 'No tienes permiso para hacer esto.',
  404: 'No se encontró la información que pediste.',
  409: 'Esto ya no se puede hacer con el estado actual. Actualiza la pantalla e intenta de nuevo.',
  413: 'El archivo pesa demasiado.',
  429: 'Demasiados intentos seguidos. Espera un momento y vuelve a intentar.',
  500: 'Algo falló en el servidor. Intenta de nuevo.',
  502: 'El servidor no está respondiendo. Intenta de nuevo en un momento.',
  503: 'El servidor no está disponible por ahora. Intenta de nuevo en un momento.',
  504: 'El servidor tardó demasiado en responder. Intenta de nuevo.',
};

export function mensajeDeError(status, data) {
  if (data?.message) return data.message;
  const detalle = DESCRIPCION_ERROR[status] || 'No se pudo completar la acción. Intenta de nuevo.';
  return `${detalle} (error ${status})`;
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

  if (res.status === 401 && !options.skipAuthRedirect) {
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
  if (!res.ok) {
    // El cuerpo viaja con el error: varias respuestas de fallo traen datos
    // útiles junto al mensaje (p. ej. la máquina ya actualizada con el motivo
    // por el que su Sonoff no respondió), y sin esto se perdían.
    const error = new Error(mensajeDeError(res.status, data));
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get:    (path)              => request(path),
  post:   (path, body, opts)  => request(path, { method: 'POST',   body: JSON.stringify(body), ...opts }),
  put:    (path, body) => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body) => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)       => request(path, { method: 'DELETE' }),
};
