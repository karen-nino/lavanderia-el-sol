import { useAuth } from '../context/AuthContext';
import { esAdmin, esAdminMain } from '../lib/roles';
import SeleccionarSucursal from '../pages/SeleccionarSucursal';

// Intercepta el ingreso al panel: si el usuario es admin (no admin_main) y
// todavía no ha elegido sucursal, muestra la pantalla de selección en lugar
// del panel. El admin_main y los operadores pasan directo. Como el login
// reinicia la sucursal activa a null para los admins globales, esta selección
// se pide en cada inicio de sesión.
export default function SucursalGate({ children }) {
  const { usuario, sucursalActiva } = useAuth();
  const debeElegir =
    esAdmin(usuario?.rol) && !esAdminMain(usuario?.rol) && !sucursalActiva;

  if (debeElegir) return <SeleccionarSucursal />;
  return children;
}
