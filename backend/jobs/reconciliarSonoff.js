// Reconciliador Sonoff — red de seguridad del control de máquinas.
//
// Cada SONOFF_RECONCILE_MINUTOS (por defecto 3) recorre las máquinas con
// Sonoff enlazado y vuelve a afirmar su estado deseado (sincronizarSonoff es
// idempotente). Así corrige cualquier desincronización dejada por una orden
// que falló (internet caído, nube eWeLink sin responder, backend reiniciado a
// mitad de una operación) y refresca maquinas.sonoff_estado para el indicador.
//
// El camino normal es el enganche por evento (trigger + LISTEN/NOTIFY): esto es
// solo el respaldo periódico.

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
