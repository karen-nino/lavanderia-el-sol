// Escucha el canal 'maquina_sync' en una conexión propia (con reconexión): el
// trigger trg_notificar_sync_maquina avisa cuando cambia el estado o el enlace
// de una máquina, y se llama a sincronizarSonoff(id). Si se cae, cubre el barrido.

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

/** Para pruebas y apagado limpio. */
export async function detenerListenerSonoff() {
  detenido = true;
  try { await cliente?.end(); } catch { /* noop */ }
  cliente = null;
}
