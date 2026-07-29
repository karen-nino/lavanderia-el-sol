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

// Libera todas las máquinas que quedaron en uso y cierra sus notas en proceso
// como LISTA (mismo efecto que el "Procesar carga" manual). Idempotente: si no
// hay nada en proceso no cambia nada. Devuelve los conteos afectados.
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
