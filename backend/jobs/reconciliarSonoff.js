// Barrido periódico de respaldo del control Sonoff: cada SONOFF_RECONCILE_MINUTOS
// (3 por defecto) vuelve a afirmar el estado de las máquinas enlazadas, corrige
// órdenes que fallaron y refresca sonoff_estado. El camino normal es el evento
// (trigger + LISTEN/NOTIFY).

import pool from '../db/pool.js';
import { sincronizarSonoff } from '../services/sincronizarSonoff.js';

const INTERVALO_MS = (() => {
  const m = Number(process.env.SONOFF_RECONCILE_MINUTOS);
  const min = Number.isFinite(m) && m > 0 ? m : 3;
  return min * 60 * 1000;
})();

export async function reconciliarSonoff() {
  const { rows } = await pool.query(
    'SELECT id FROM maquinas WHERE device_id IS NOT NULL ORDER BY id'
  );
  for (const { id } of rows) {
    // reconciliando: no reenciende lo que alguien apagó a mano (ver el servicio).
    await sincronizarSonoff(id, { reconciliando: true }); // no lanza; best-effort
  }
  return rows.length;
}

export function iniciarReconciliadorSonoff() {
  const correr = () => {
    reconciliarSonoff().catch((err) =>
      console.error('reconciliarSonoff error:', err)
    );
  };
  // Primera pasada al arrancar y luego cada intervalo.
  correr();
  setInterval(correr, INTERVALO_MS);
  console.log(`Reconciliador Sonoff activo (cada ${INTERVALO_MS / 60000} min).`);
}
