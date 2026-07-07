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

async function request(path, options = {}) {
  const token = getToken();
  const sucursal = getSucursal();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(sucursal ? { 'X-Sucursal': sucursal } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = '/login';
    return;
  }

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Error en la solicitud');
  return data;
}

export const api = {
  get:    (path)       => request(path),
  post:   (path, body) => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body) => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body) => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)       => request(path, { method: 'DELETE' }),
};
