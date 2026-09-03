import { randomUUID } from 'crypto';
import pool from '../db/pool.js';

// Hora local del negocio en la que se hace el barrido de "cierre del día".
// Configurable con CIERRE_HORA (0-23) y TZ_NEGOCIO; por defecto 00:00 en
// America/Mexico_City (medianoche, con el negocio ya cerrado).
const TZ = process.env.TZ_NEGOCIO || 'America/Mexico_City';
const CIERRE_HORA = (() => {
  const h = Number(process.env.CIERRE_HORA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 0;
})();
const INTERVALO_MS = 5 * 60 * 1000; // revisar cada 5 minutos

const fmtHora  = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// Barrido de fin de día. Hace dos cosas:
//   1. Libera las máquinas que quedaron EN USO y cierra sus notas como LISTA
//      (mismo efecto que el "Procesar carga" manual).
//   2. Suelta las máquinas que se asignaron pero nunca se arrancaron: esas
//      notas quedaban En Espera reteniendo su lavadora indefinidamente.
// Idempotente: si no hay nada pendiente no cambia nada. Devuelve los conteos.
export async function liberarMaquinasCierreDelDia() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Se cierran TODAS las notas en proceso (no solo las de la columna legada
    // maquina_id): con varias cargas la(s) máquina(s) puede(n) vivir solo en
    // nota_cargas. Se guardan sus IDs para limpiar sus cargas.
    const notas = await client.query(
      `UPDATE notas SET estado = 'LISTA'
         WHERE estado IN ('LAVANDO', 'SECANDO')
       RETURNING id`
    );
    const notaIds = notas.rows.map(r => r.id);

    // Las cargas conservan su máquina como "usada" (historial), pero sueltan la
    // referencia viva (lavadora_id / secadora_id). Si no, la nota cerrada se
    // seguiría viendo "en curso" en Detalle aunque su máquina ya esté libre.
    if (notaIds.length > 0) {
      await client.query(
        `UPDATE nota_cargas
            SET lavadora_usada_id = COALESCE(lavadora_usada_id, lavadora_id),
                secadora_usada_id = COALESCE(secadora_usada_id, secadora_id),
                lavadora_id = NULL,
                secadora_id = NULL
          WHERE nota_id = ANY($1)`,
        [notaIds]
      );
    }

    const maquinas = await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
         WHERE estado = 'en_uso'`
    );

    // Máquinas que se asignaron a una nota y nunca se arrancaron: la nota se
    // quedó En Espera y arrastraba su lavadora un día tras otro. Al cerrar el
    // día se sueltan (la carga vuelve a "sin asignar") y la nota sigue viva:
    // cuando el cliente vuelva se le asigna la máquina que esté libre. No se
    // guardan como "usadas" porque nunca lavaron nada.
    const { rows: [{ sueltas }] } = await client.query(
      `WITH liberadas AS (
         UPDATE nota_cargas nc
            SET lavadora_id = NULL, secadora_id = NULL,
                lavadora_usada_id = CASE WHEN nc.lavadora_usada_id = nc.lavadora_id
                                         THEN NULL ELSE nc.lavadora_usada_id END,
                secadora_usada_id = CASE WHEN nc.secadora_usada_id = nc.secadora_id
                                         THEN NULL ELSE nc.secadora_usada_id END
          FROM notas n
          WHERE n.id = nc.nota_id
            AND n.estado = 'EN_ESPERA'
            AND (nc.lavadora_id IS NOT NULL OR nc.secadora_id IS NOT NULL)
          RETURNING nc.id
       )
       SELECT COUNT(*)::int AS sueltas FROM liberadas`
    );

    await client.query('COMMIT');
    return {
      maquinasLiberadas: maquinas.rowCount,
      notasListas: notas.rowCount,
      cargasSueltas: sueltas,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Cierra (invalida) las sesiones de los empleados al cierre del día. Al asignar
// un session_id nuevo, los tokens vigentes dejan de coincidir (verifyToken los
// rechaza) y el empleado tendrá que iniciar sesión de nuevo al día siguiente,
// registrando así su nueva hora de entrada. NO registra "salida": si el
// empleado no cerró sesión manualmente, ese día su salida queda en null y se
// muestra como "—". Solo afecta empleados (operador); los admin conservan su
// sesión.
export async function cerrarSesionesEmpleados() {
  const { rowCount } = await pool.query(
    `UPDATE usuarios SET session_id = $1
       WHERE activo = TRUE AND rol = 'operador' AND session_id IS NOT NULL`,
    [randomUUID()]
  );
  return rowCount;
}

// Cierra las cajas que quedaron abiertas al terminar el día.
//
// Un cierre automático NO es un corte: nadie contó el cajón, así que
// `monto_contado` queda NULL (el historial ya lo muestra como "—" y sin
// diferencia) y `usuario_cierre_id` también, porque ninguna persona lo hizo.
// La bandera `cierre_automatico` (mig. 099) es lo que permite distinguirlo de
// un corte real en el historial.
//
// Sin esto, la sesión seguía viva al día siguiente: nadie podía abrir caja, y
// las ventas del día nuevo se sumaban a la sesión vieja hasta que alguien la
// cerraba, momento en el que el esperado de dos días se comparaba contra el
// efectivo de uno solo y aparecía un faltante inventado.
//
// Cierra las de TODAS las sucursales (el barrido es global). No lanza al
// llamador: devuelve las cajas cerradas.
export async function cerrarCajasAbiertas() {
  const { rows } = await pool.query(
    `UPDATE cajas
        SET estado            = 'cerrada',
            cerrada_at        = NOW(),
            cierre_automatico = TRUE,
            notas_cierre      = COALESCE(
              notas_cierre,
              'Cerrada automáticamente en el cierre del día. Nadie cerró la caja, así que no hubo conteo de efectivo.'
            )
      WHERE estado = 'abierta'
      RETURNING id, sucursal`
  );
  return rows;
}

// Scheduler ligero (sin dependencias): revisa cada pocos minutos y ejecuta el
// barrido una sola vez al llegar la hora de cierre, deduplicando por fecha local.
export function iniciarCierreDelDia() {
  let ultimaFecha = null;

  const tick = async () => {
    const hora  = Number(fmtHora.format(new Date()));
    const fecha = fmtFecha.format(new Date());
    if (hora !== CIERRE_HORA || ultimaFecha === fecha) return;
    ultimaFecha = fecha;
    try {
      const r = await liberarMaquinasCierreDelDia();
      if (r.maquinasLiberadas > 0 || r.cargasSueltas > 0) {
        console.log(`[cierre] ${fecha}: ${r.maquinasLiberadas} máquina(s) liberada(s), ${r.notasListas} nota(s) a LISTA, ` +
                    `${r.cargasSueltas} carga(s) sin arrancar liberada(s)`);
      }
    } catch (err) {
      console.error('[cierre] error al liberar máquinas:', err.message);
    }
    // Cerrar las cajas que nadie cerró: si siguen abiertas mañana, el corte
    // del día siguiente sale con las ventas de dos días.
    try {
      const cajas = await cerrarCajasAbiertas();
      if (cajas.length > 0) {
        console.log(`[cierre] ${fecha}: ${cajas.length} caja(s) cerrada(s) automáticamente sin conteo ` +
                    `(sucursal: ${cajas.map(c => c.sucursal).join(', ')})`);
      }
    } catch (err) {
      console.error('[cierre] error al cerrar cajas abiertas:', err.message);
    }

    // Cerrar las sesiones de los empleados que no cerraron manualmente.
    try {
      const cerradas = await cerrarSesionesEmpleados();
      if (cerradas > 0) {
        console.log(`[cierre] ${fecha}: ${cerradas} sesión(es) de empleado cerrada(s)`);
      }
    } catch (err) {
      console.error('[cierre] error al cerrar sesiones de empleados:', err.message);
    }
  };

  setInterval(tick, INTERVALO_MS);
  console.log(`Cierre del día programado a las ${String(CIERRE_HORA).padStart(2, '0')}:00 (${TZ})`);
}
