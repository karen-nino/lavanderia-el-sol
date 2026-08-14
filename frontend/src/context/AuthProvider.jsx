import { useState } from 'react';
import { AuthContext } from './AuthContext';
import { api } from '../lib/api';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [usuario, setUsuario] = useState(() => {
    try {
      const u = localStorage.getItem('usuario');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  // Sucursal que se está administrando. Para un empleado siempre es la suya;
  // un admin puede cambiarla con el selector. Se persiste para que api.js la
  // envíe en el header X-Sucursal en cada petición.
  const [sucursalActiva, setSucursalActivaState] = useState(
    () => localStorage.getItem('sucursalActiva') || null
  );

  const persistSucursal = (slug) => {
    if (slug) localStorage.setItem('sucursalActiva', slug);
    else localStorage.removeItem('sucursalActiva');
    setSucursalActivaState(slug || null);
  };

  const login = (newToken, newUsuario) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('usuario', JSON.stringify(newUsuario));
    setToken(newToken);
    setUsuario(newUsuario);
    // Al iniciar sesión se arranca en la sucursal propia del usuario.
    persistSucursal(newUsuario?.sucursal || null);
  };

  const logout = () => {
    // Registrar la salida (cierre de sesión manual) antes de borrar el token.
    // Es "fire-and-forget": la petición ya lleva el token y no debe frenar el
    // cierre de sesión aunque falle.
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    persistSucursal(null);
    setToken(null);
    setUsuario(null);
  };

  const updateUsuario = (updates) => {
    setUsuario(prev => {
      const next = { ...prev, ...updates };
      localStorage.setItem('usuario', JSON.stringify(next));
      return next;
    });
  };

  // Cambia la sucursal activa (admin). Por defecto recarga para que todas las
  // vistas y sus refrescos periódicos vuelvan a pedir datos de la nueva
  // sucursal. En la selección inicial tras el login (cuando aún no hay panel
  // montado) se pasa { reload: false } para entrar sin recargar.
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
