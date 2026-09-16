// Reglas de la lista de Empleados: quién sale y a quién se le pinta la marca de
// usuario de prueba. Viven fuera de la página para poder probarlas — la regla
// ya dejó la pantalla vacía una vez, en la demo pública, y eso no se ve hasta
// abrirla.
import { esAdmin as esAdminFn } from './roles';
import { ES_DEMO } from './entorno';

// Usuarios de prueba: no están ligados a una sucursal y en la lista de
// Empleados solo los ve el admin_main. Se identifican con la bandera es_prueba
// de la base (no por el nombre), así se pueden renombrar sin perder la marca.
export const esUsuarioPrueba = (e) => e?.es_prueba === true;

// En la DEMO todos los usuarios son de prueba —el visitante y el personal que
// dé de alta—, así que la marca no distingue a nadie: pintarla dejaría la lista
// entera en ámbar y con la etiqueta "Prueba" en vez del rol. Solo para lo
// visual; quién aparece en la lista se decide en empleadoVisible.
export const marcarComoPrueba = (e) => esUsuarioPrueba(e) && !ES_DEMO;

// ¿Sale este usuario en la lista?
//   · quienMira:      el usuario de la sesión (para su propia tarjeta)
//   · sucursalVista:  la sucursal activa, o null para no filtrar por ella
//   · esAdminMain:    si quien mira es el Admin Main
export function empleadoVisible(e, { quienMira, sucursalVista, esAdminMain }) {
  const prueba = esUsuarioPrueba(e);
  // Los usuarios de prueba solo los ve el admin_main (y siempre, sin importar
  // la sucursal activa). En la demo no: ahí TODOS lo son —el visitante
  // incluido—, así que este filtro dejaba la página vacía, con "No hay
  // empleados registrados" y sin la propia tarjeta de quien mira.
  if (prueba && !esAdminMain && !ES_DEMO) return false;
  // El admin_main se oculta de la lista, salvo el propio usuario (para que
  // siempre vea su tarjeta).
  if (e.rol === 'admin_main' && e.id !== quienMira?.id) return false;
  // Solo empleados (operadores) de la sucursal activa. Los admins son globales
  // (sin sucursal). Los usuarios de prueba viven en la sucursal oculta de
  // pruebas (mig. 095), que nadie puede seleccionar: si se filtraran por
  // sucursal, el admin_main no los vería nunca.
  if (!prueba && !esAdminFn(e.rol) && sucursalVista && e.sucursal !== sucursalVista) return false;
  return true;
}
