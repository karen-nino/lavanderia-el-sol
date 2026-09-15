import pool from '../db/pool.js';

// El slug se repite aquí a propósito, en vez de importarlo de
// middleware/sucursalActiva.js: ese módulo necesita ENTORNO_DEMO, y el import
// mutuo dejaría una de las dos constantes sin inicializar según quién cargue
// primero.
const SUCURSAL_PRUEBAS = 'pruebas';

// ENTORNO_DEMO=1 marca la instancia de DEMOSTRACIÓN PÚBLICA: una copia de la
// app con su propia base, llena de datos inventados, para enseñar el sistema
// sin exponer el del negocio.
//
// La variable afloja cosas que en la instancia real son barreras de verdad
// (el acceso sin contraseña y el bloqueo de la configuración global), así que
// encenderla por error donde hay operación real sería grave. Por eso existe
// verificarEntornoDemo(), que se llama al arrancar: si la base tiene trabajo
// real, el proceso no levanta.
export const ENTORNO_DEMO = process.env.ENTORNO_DEMO === '1';

// Una base con notas fuera de la sucursal de pruebas es una base con
// operación real. Mismo criterio que usa el seeder de datos falsos.
export async function verificarEntornoDemo() {
  if (!ENTORNO_DEMO) return;

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM notas WHERE sucursal <> $1', [SUCURSAL_PRUEBAS]
  );

  if (rows[0].n > 0) {
    console.error(
      `\nENTORNO_DEMO=1 sobre una base con ${rows[0].n} notas fuera de la sucursal ` +
      `"${SUCURSAL_PRUEBAS}".\n` +
      'Esa bandera abre el acceso sin contraseña y levanta el bloqueo de la ' +
      'configuración global: no puede activarse sobre datos reales.\n' +
      'Quita ENTORNO_DEMO de los secretos de esta app.\n'
    );
    process.exit(1);
  }

  console.log('ENTORNO_DEMO activo: acceso sin contraseña y configuración global editable.');
}
