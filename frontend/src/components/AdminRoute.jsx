import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { esAdmin } from '../lib/roles';

export default function AdminRoute({ children }) {
  const { usuario } = useAuth();
  return esAdmin(usuario?.rol) ? children : <Navigate to="/" replace />;
}
