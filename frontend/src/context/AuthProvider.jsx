import { useState } from 'react';
import { AuthContext } from './AuthContext';
import { api } from '../lib/api';
import { almacenSesion } from '../lib/sesion';

/** Slugs renombrados: una sesión guardada puede traer el viejo (el backend también lo traduce). */
const SLUGS_RENOMBRADOS = { lopez_cotilla: 'zapopan' };
const slugVigente = (slug) => SLUGS_RENOMBRADOS[slug] ?? slug;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => almacenSesion.getItem('token'));
  const [usuario, setUsuario] = useState(() => {
    try {
      const u = almacenSesion.getItem('usuario');
      if (!u) return null;
      const parsed = JSON.parse(u);
      return parsed?.sucursal ? { ...parsed, sucursal: slugVigente(parsed.sucursal) } : parsed;
    } catch {
      return null;
    }
  });
  // Sucursal que se administra: la propia para un empleado; un admin la cambia
  // con el selector. Se guarda para que api.js la mande en X-Sucursal.
  const [sucursalActiva, setSucursalActivaState] = useState(
    () => slugVigente(almacenSesion.getItem('sucursalActiva')) || null
  );

  const persistSucursal = (slug) => {
    if (slug) almacenSesion.setItem('sucursalActiva', slug);
    else almacenSesion.removeItem('sucursalActiva');
    setSucursalActivaState(slug || null);
  };

  const login = (newToken, newUsuario) => {
    almacenSesion.setItem('token', newToken);
    almacenSesion.setItem('usuario', JSON.stringify(newUsuario));
    setToken(newToken);
    setUsuario(newUsuario);
    // Al iniciar sesión se arranca en la sucursal propia del usuario.
    persistSucursal(newUsuario?.sucursal || null);
  };

  const logout = () => {
    // Registra la salida sin esperar respuesta (no frena el cierre de sesión).
    api.post('/auth/logout').catch(() => {});
    almacenSesion.removeItem('token');
    almacenSesion.removeItem('usuario');
    // Rastros de navegación del turno (p. ej. el filtro de notas): el siguiente
    // empleado no debe encontrarlos.
    try { sessionStorage.clear(); } catch { /* ignore */ }
    persistSucursal(null);
    setToken(null);
    setUsuario(null);
  };

  const updateUsuario = (updates) => {
    setUsuario(prev => {
      const next = { ...prev, ...updates };
      almacenSesion.setItem('usuario', JSON.stringify(next));
      return next;
    });
  };

  // Cambia la sucursal activa y recarga para que todo pida datos de la nueva.
  // Tras el login se pasa { reload: false } (aún no hay panel montado).
  const setSucursalActiva = (slug, { reload = true } = {}) => {
    if (!slug || slug === sucursalActiva) return;
    persistSucursal(slug);
    if (reload) window.location.reload();
  };

  return (
    <AuthContext.Provider
      value={{ token, usuario, sucursalActiva, login, logout, updateUsuario, setSucursalActiva }}
    >
      {children}
    </AuthContext.Provider>
  );
}
