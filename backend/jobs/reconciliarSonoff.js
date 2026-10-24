// Barrido periódico de respaldo del control Sonoff: cada SONOFF_RECONCILE_MINUTOS
// (3 por defecto) vuelve a afirmar el estado de las máquinas enlazadas, corrige
// órdenes que fallaron y refresca sonoff_estado. El camino normal es el evento
// (trigger + LISTEN/NOTIFY). Lee los Sonoff en lote y se salta mientras eWeLink
// esté en pausa por el límite de llamadas.

import pool from '../db/pool.js';
import { sincronizarSonoff } from '../services/sincronizarSonoff.js';
import * as dispositivos from '../services/dispositivos/index.js';

const INTERVALO_MS = (() => {
  const m = Number(process.env.SONOFF_RECONCILE_MINUTOS);
  const min = Number.isFinite(m) && m > 0 ? m : 3;
  return min * 60 * 1000;
})();

export async function reconciliarSonoff() {
  // Sin llamadas mientras eWeLink esté en pausa por el límite: solo gastaría más.
  if (dispositivos.enPausaPorLimite()) return 0;
  const { rows } = await pool.query(
    'SELECT id, sucursal, device_id, device_canal FROM maquinas WHERE device_id IS NOT NULL ORDER BY id'
  );
  // Una lectura por cada 10 Sonoff en vez de una por máquina.
  await dispositivos.precargarEstados(rows);
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
