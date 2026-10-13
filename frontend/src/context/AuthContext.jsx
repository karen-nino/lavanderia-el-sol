import { createContext, useContext } from 'react';

// Solo el contexto y el hook (sin componentes), para Fast Refresh. El proveedor
// está en AuthProvider.jsx.
export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}
