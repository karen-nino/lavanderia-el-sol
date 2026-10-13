// Driver de simulación (por defecto): los Sonoff viven en memoria, por
// device_id, para desarrollar y probar sin hardware. Registra cada operación en
// consola: no prende nada real. En producción se usa DISPOSITIVOS_DRIVER=ewelink.

const estados = new Map(); // device_id -> 'on' | 'off'

const log = (accion, maquina) =>
  console.log(`[dispositivos:null] ${accion} device_id=${maquina.device_id}` +
    (maquina.device_canal != null ? ` canal=${maquina.device_canal}` : ''));

export async function encender(maquina) {
  estados.set(maquina.device_id, 'on');
  log('ENCENDER (simulado)', maquina);
  return { ok: true, estado: 'on' };
}

export async function apagar(maquina) {
  estados.set(maquina.device_id, 'off');
  log('APAGAR (simulado)', maquina);
  return { ok: true, estado: 'off' };
}

export async function estado(maquina) {
  const e = estados.get(maquina.device_id) ?? 'off';
  return { ok: true, estado: e };
}

/** Solo para pruebas: reinicia el estado simulado. */
export function _reset() {
  estados.clear();
}
