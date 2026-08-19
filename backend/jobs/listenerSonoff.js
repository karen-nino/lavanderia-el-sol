// Listener LISTEN/NOTIFY — enganche central del control de máquinas.
//
// Mantiene una conexión dedicada a Postgres escuchando el canal 'maquina_sync'.
// El trigger trg_notificar_sync_maquina (migración 075) emite un aviso con el
// id de la máquina cada vez que cambia su estado o su enlace Sonoff, sin
// importar desde qué flujo. Al recibirlo, se dispara sincronizarSonoff(id).
//
// Es una conexión persistente (no del pool), con reconexión automática: si se
// cae, el reconciliador periódico cubre el hueco hasta que vuelva.

import pg from 'pg';
import { dbConfig } from '../db/pool.js';
import { sincronizarSonoff } from '../services/sincronizarSonoff.js';

const CANAL = 'maquina_sync';
const REINTENTO_MS = 5000;

let cliente = null;
let detenido = false;

async function conectar() {
  if (detenido) return;
  cliente = new pg.Client(dbConfig);

  cliente.on('notification', (msg) => {
    if (msg.channel !== CANAL) return;
    const id = Number(msg.payload);
    if (!Number.isInteger(id)) return;
    sincronizarSonoff(id); // no lanza; best-effort
  });

  cliente.on('error', (err) => {
    console.error('listenerSonoff: error de conexión:', err.message);
    reconectar();
  });

  try {
    await cliente.connect();
    await cliente.query(`LISTEN ${CANAL}`);
    console.log(`Listener Sonoff activo (LISTEN ${CANAL}).`);
  } catch (err) {
    console.error('listenerSonoff: fallo al conectar:', err.message);
    reconectar();
  }
}

let reconectando = false;
function reconectar() {
  if (detenido || reconectando) return;
  reconectando = true;
  try { cliente?.removeAllListeners(); cliente?.end().catch(() => {}); } catch { /* noop */ }
  cliente = null;
  setTimeout(() => { reconectando = false; conectar(); }, REINTENTO_MS);
}

export function iniciarListenerSonoff() {
  detenido = false;
  conectar();
}

// Para pruebas / apagado limpio.
export async function detenerListenerSonoff() {
  detenido = true;
  try { await cliente?.end(); } catch { /* noop */ }
  cliente = null;
}
