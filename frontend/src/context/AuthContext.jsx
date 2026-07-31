import { createContext, useContext } from 'react';

// Solo el contexto y el hook viven aquí (sin componentes) para que Fast Refresh
// funcione. El proveedor está en AuthProvider.jsx.
export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}
