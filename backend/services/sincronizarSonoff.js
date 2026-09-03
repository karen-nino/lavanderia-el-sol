// Servicio central de sincronización Sonoff.
//
// Toma el ESTADO que la máquina tiene en la BD como fuente de verdad y ordena
// al dispositivo físico que coincida:
//   maquinas.estado = 'en_uso'  → encender el Sonoff.
//   cualquier otro estado       → apagar el Sonoff.
//
// Con una excepción: el barrido periódico no reenciende una máquina que quedó
// apagada después de que una orden nuestra sí funcionó (ver `reconciliando`).
// Apagar de más nunca es peligroso; encender de más, sí.
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
// Excepción: con el driver de simulación no se marca 'enlazada' (ver abajo).

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
//
// `reconciliando` distingue quién llama: el barrido periódico (true) o el
// evento real de la nota al arrancar o terminar una máquina (false). Solo el
// evento enciende de forma incondicional; ver la regla abajo.
export async function sincronizarSonoff(maquinaId, { reconciliando = false } = {}) {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, estado, device_id, device_canal, sonoff_estado FROM maquinas WHERE id = $1',
      [maquinaId]
    );
    if (rows.length === 0) return null;
    const maq = rows[0];

    if (!dispositivos.tieneDispositivo(maq)) {
      return marcar(maq.id, 'sin_enlazar');
    }

    const deseado = estadoDeseado(maq.estado);

    // El barrido NO vuelve a encender una máquina que quedó apagada si la
    // última orden que le mandamos sí se aplicó ('enlazada'): en ese caso el
    // relé se abrió después, y eso solo pasa si una persona lo apagó (o se fue
    // la luz). Reencenderla arrancaría un equipo que alguien detuvo a
    // propósito, quizá con las manos dentro.
    //
    // Si la última orden falló ('error'), el encendido nunca llegó a ocurrir:
    // ahí sí se reintenta, que es para lo que existe el reconciliador.
    if (deseado === 'on' && reconciliando && maq.sonoff_estado === 'enlazada') {
      const real = await dispositivos.estado(maq);
      if (dispositivos.esSimulacion()) return maq;
      if (real.ok && real.estado === 'off') {
        console.warn(
          `[sonoff] ${maq.nombre ?? maq.id} está apagada pero su nota sigue en uso: ` +
          'la apagaron a mano. No se reenciende.'
        );
        return marcar(maq.id, 'enlazada');
      }
      return marcar(maq.id, real.ok ? 'enlazada' : 'error');
    }

    const res = deseado === 'on'
      ? await dispositivos.encender(maq)
      : await dispositivos.apagar(maq);

    // En simulación el driver siempre responde ok: marcar 'enlazada' pintaría
    // el indicador en verde sin que exista ningún Sonoff detrás. Se deja el
    // estado como estaba (la operación simulada ya quedó en el log).
    if (dispositivos.esSimulacion()) return maq;

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
