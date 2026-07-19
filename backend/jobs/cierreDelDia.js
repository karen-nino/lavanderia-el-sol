import pool from '../db/pool.js';

// Hora local del negocio en la que se hace el barrido de "cierre del día".
// Configurable con CIERRE_HORA (0-23) y TZ_NEGOCIO; por defecto 03:00 en
// America/Mexico_City (de madrugada, con el negocio ya cerrado).
const TZ = process.env.TZ_NEGOCIO || 'America/Mexico_City';
const CIERRE_HORA = (() => {
  const h = Number(process.env.CIERRE_HORA);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 3;
})();
const INTERVALO_MS = 5 * 60 * 1000; // revisar cada 5 minutos

const fmtHora  = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// Libera todas las máquinas que quedaron en uso y marca sus notas en proceso
// como LISTA (mismo efecto que el "Procesar carga" manual). Idempotente: si no
// hay nada en uso no cambia nada. Devuelve los conteos afectados.
export async function liberarMaquinasCierreDelDia() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Primero las notas (mientras las máquinas siguen en_uso), luego se liberan.
    const notas = await client.query(
      `UPDATE notas SET estado = 'LISTA'
         WHERE estado IN ('LAVANDO', 'SECANDO')
           AND maquina_id IN (SELECT id FROM maquinas WHERE estado = 'en_uso')`
    );
    const maquinas = await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
         WHERE estado = 'en_uso'`
    );
    await client.query('COMMIT');
    return { maquinasLiberadas: maquinas.rowCount, notasListas: notas.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
      if (r.maquinasLiberadas > 0) {
        console.log(`[cierre] ${fecha}: ${r.maquinasLiberadas} máquina(s) liberada(s), ${r.notasListas} nota(s) a LISTA`);
      }
    } catch (err) {
      console.error('[cierre] error al liberar máquinas:', err.message);
    }
  };

  setInterval(tick, INTERVALO_MS);
  console.log(`Cierre del día programado a las ${String(CIERRE_HORA).padStart(2, '0')}:00 (${TZ})`);
}
