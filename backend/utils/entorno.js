import pool from '../db/pool.js';

// Repetido a propósito: importarlo de sucursalActiva.js sería un import circular.
const SUCURSAL_PRUEBAS = 'pruebas';

/**
 * ENTORNO_DEMO=1: instancia de demostración pública, con su propia base de
 * datos inventados. Abre el acceso sin contraseña y la configuración global,
 * así que al arrancar verificarEntornoDemo() impide levantar sobre una base real.
 */
export const ENTORNO_DEMO = process.env.ENTORNO_DEMO === '1';

/** Reintentos: la base de la demo se duerme y el primer intento puede fallar. */
const INTENTOS = 3;
const ESPERA_MS = 2000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Detiene el arranque si la base tiene notas fuera de la sucursal de pruebas (operación real). */
export async function verificarEntornoDemo() {
  if (!ENTORNO_DEMO) return;

  let rows;
  for (let intento = 1; ; intento++) {
    try {
      ({ rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM notas WHERE sucursal <> $1', [SUCURSAL_PRUEBAS]
      ));
      break;
    } catch (err) {
      if (intento < INTENTOS) {
        console.warn(`No se pudo comprobar el entorno (intento ${intento}/${INTENTOS}): ${err.message}`);
        await dormir(ESPERA_MS * intento);
        continue;
      }
      // Si no se puede comprobar, no se arranca.
      console.error(
        `\nNo se pudo comprobar si esta base es la de la demo: ${err.message}\n` +
        'Con ENTORNO_DEMO=1 no se arranca a ciegas, porque esa bandera abre el ' +
        'acceso sin contraseña.\nRevisa que la base responda y vuelve a desplegar.\n'
      );
      process.exit(1);
    }
  }

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
