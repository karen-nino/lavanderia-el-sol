import pool from '../db/pool.js';

// La campana muestra las últimas 24 h; se borran las de más de 48 h (y sus
// descartes, en cascada).
const RETENCION_HORAS = 48;
const INTERVALO_MS = 6 * 60 * 60 * 1000; // cada 6 horas

export async function purgarNotificaciones() {
  const { rowCount } = await pool.query(
    `DELETE FROM notificaciones WHERE created_at < NOW() - ($1 * INTERVAL '1 hour')`,
    [RETENCION_HORAS]
  );
  return rowCount;
}

/** Una pasada al arrancar y luego cada 6 h. */
export function iniciarLimpiezaNotificaciones() {
  const tick = async () => {
    try {
      const n = await purgarNotificaciones();
      if (n > 0) console.log(`[limpieza] ${n} notificación(es) antigua(s) eliminada(s)`);
    } catch (err) {
      console.error('[limpieza] error al purgar notificaciones:', err.message);
    }
  };

  setTimeout(tick, 30 * 1000); // primera pasada 30 s tras arrancar
  setInterval(tick, INTERVALO_MS);
  console.log(`Limpieza de notificaciones programada cada 6 h (retención ${RETENCION_HORAS} h)`);
}
