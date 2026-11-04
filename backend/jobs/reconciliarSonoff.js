// Barrido periódico de respaldo del control Sonoff: cada SONOFF_RECONCILE_MINUTOS
// (3 por defecto) vuelve a afirmar el estado de las máquinas enlazadas, corrige
// órdenes que fallaron y refresca sonoff_estado. El camino normal es el evento
// (trigger + LISTEN/NOTIFY). Lee los Sonoff en lote y se salta mientras eWeLink
// esté en pausa por el límite de llamadas. Fuera del horario de la sucursal (más
// una hora) solo revisa las máquinas encendidas, para no gastar llamadas de noche.

import pool from '../db/pool.js';
import { sincronizarSonoff } from '../services/sincronizarSonoff.js';
import * as dispositivos from '../services/dispositivos/index.js';
import { abiertaConMargen } from '../utils/horario.js';

const INTERVALO_MS = (() => {
  const m = Number(process.env.SONOFF_RECONCILE_MINUTOS);
  const min = Number.isFinite(m) && m > 0 ? m : 3;
  return min * 60 * 1000;
})();

/** Minutos que el barrido sigue completo después de la hora de cerrar. */
const MARGEN_CIERRE_MIN = 60;

/**
 * ¿Toca revisar esta máquina? En horario, todas; fuera de horario, solo las que
 * deben estar encendidas o esperan su caducidad (encendido manual, arranque).
 */
export function tocaBarrer(m, ahora = new Date()) {
  if (abiertaConMargen(m.horario_semana, ahora, MARGEN_CIERRE_MIN)) return true;
  return m.estado === 'en_uso' || m.encendida_manual_at != null || m.encendida_sin_iniciar_at != null;
}

export async function reconciliarSonoff() {
  // Sin llamadas mientras eWeLink esté en pausa por el límite: solo gastaría más.
  if (dispositivos.enPausaPorLimite()) return 0;
  const { rows: todas } = await pool.query(
    `SELECT m.id, m.sucursal, m.device_id, m.device_canal, m.estado,
            m.encendida_manual_at, m.encendida_sin_iniciar_at, s.horario_semana
       FROM maquinas m
       LEFT JOIN sucursales s ON s.slug = m.sucursal
      WHERE m.device_id IS NOT NULL
      ORDER BY m.id`
  );
  const ahora = new Date();
  const rows = todas.filter((m) => tocaBarrer(m, ahora));
  if (rows.length === 0) return 0;
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
