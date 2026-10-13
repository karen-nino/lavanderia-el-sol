// Reglas de la lista de Empleados: quién sale y a quién se le pone la marca de
// usuario de prueba.
import { esAdmin as esAdminFn } from './roles';
import { ES_DEMO } from './entorno';

/** Usuarios de prueba, por la bandera es_prueba (no por el nombre). */
export const esUsuarioPrueba = (e) => e?.es_prueba === true;

/**
 * Marca visual de prueba; en la demo todos lo son y no se pinta. Quién sale en
 * la lista lo decide empleadoVisible.
 */
export const marcarComoPrueba = (e) => esUsuarioPrueba(e) && !ES_DEMO;

/**
 * ¿Sale este usuario en la lista?
 * @param quienMira el usuario de la sesión (su propia tarjeta siempre sale).
 * @param sucursalVista la sucursal activa, o null para no filtrar.
 * @param esAdminMain si quien mira es el Admin Main.
 */
export function empleadoVisible(e, { quienMira, sucursalVista, esAdminMain }) {
  const prueba = esUsuarioPrueba(e);
  // Los de prueba solo los ve el admin_main, en cualquier sucursal. En la demo
  // todos lo son, así que no se filtran.
  if (prueba && !esAdminMain && !ES_DEMO) return false;
  // El admin_main no sale, salvo en su propia tarjeta.
  if (e.rol === 'admin_main' && e.id !== quienMira?.id) return false;
  // Empleados de la sucursal activa; admins (globales) y usuarios de prueba (en
  // la sucursal oculta) no se filtran por sucursal.
  if (!prueba && !esAdminFn(e.rol) && sucursalVista && e.sucursal !== sucursalVista) return false;
  return true;
}
