import { useAuth } from '../context/AuthContext';
import { esAdmin } from '../lib/roles';
import SeleccionarSucursal from '../pages/SeleccionarSucursal';

/**
 * Si un admin no ha elegido sucursal (pasa en cada inicio de sesión), muestra
 * la selección en lugar del panel. Los empleados pasan directo.
 */
export default function SucursalGate({ children }) {
  const { usuario, sucursalActiva } = useAuth();
  // Los usuarios de prueba viven en su sucursal oculta: no eligen ninguna.
  const debeElegir = esAdmin(usuario?.rol) && !usuario?.es_prueba && !sucursalActiva;

  if (debeElegir) return <SeleccionarSucursal />;
  return children;
}
