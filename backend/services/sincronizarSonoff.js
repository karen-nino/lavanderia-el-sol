// Servicio central de sincronización Sonoff.
//
// Toma el ESTADO que la máquina tiene en la BD como fuente de verdad y ordena
// al dispositivo físico que coincida:
//   maquinas.estado = 'en_uso'  → encender el Sonoff.
//   cualquier otro estado       → apagar el Sonoff.
//
// Es idempotente: llamarlo de más no hace daño (vuelve a afirmar el mismo
// estado). Nunca lanza: al llamarse después de operaciones ya confirmadas, un
// fallo del Sonoff no debe tumbar la respuesta al usuario; solo se refleja en
// maquinas.sonoff_estado para que el indicador de la tarjeta lo muestre.
//
// Actualiza sonoff_estado según el resultado del driver:
//   sin device_id           → 'sin_enlazar'
//   driver confirmó (ok)    → 'enlazada'
//   driver no pudo (!ok)    → 'error'

import pool from '../db/pool.js';
import * as dispositivos from './dispositivos/index.js';

const estadoDeseado = (estadoMaquina) => (estadoMaquina === 'en_uso' ? 'on' : 'off');

async function marcar(id, sonoffEstado) {
  const { rows } = await pool.query(
    `UPDATE maquinas SET sonoff_estado = $1, sonoff_sync_at = NOW()
      WHERE id = $2 RETURNING *`,
    [sonoffEstado, id]
  );
  return rows[0] ?? null;
}

// Sincroniza UNA máquina (por id). Devuelve la fila actualizada, o null si no
// existe. No lanza.
export async function sincronizarSonoff(maquinaId) {
  try {
    const { rows } = await pool.query(
      'SELECT id, estado, device_id, device_canal FROM maquinas WHERE id = $1',
      [maquinaId]
    );
    if (rows.length === 0) return null;
    const maq = rows[0];

    if (!dispositivos.tieneDispositivo(maq)) {
      return marcar(maq.id, 'sin_enlazar');
    }

    const deseado = estadoDeseado(maq.estado);
    const res = deseado === 'on'
      ? await dispositivos.encender(maq)
      : await dispositivos.apagar(maq);

    return marcar(maq.id, res.ok ? 'enlazada' : 'error');
  } catch (err) {
    console.error(`sincronizarSonoff(${maquinaId}) error:`, err);
    return null;
  }
}

// Sincroniza varias máquinas por id. Best-effort, en paralelo. No lanza.
export async function sincronizarSonoffVarias(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await Promise.all([...new Set(ids)].map((id) => sincronizarSonoff(id)));
}
