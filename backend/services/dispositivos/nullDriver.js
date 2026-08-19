// nullDriver — driver por defecto cuando NO hay integración real configurada.
//
// No habla con ningún hardware: simula los Sonoff en memoria. Sirve para
// desarrollar y probar todo el flujo (sincronización, reconciliador, indicador
// de la tarjeta) sin credenciales de eWeLink ni dispositivos físicos.
//
// Guarda el último estado por device_id, así que encender→estado devuelve 'on'
// de forma coherente. Al reiniciar el proceso se pierde (arranca en 'off').
//
// IMPORTANTE: en producción hay que usar DISPOSITIVOS_DRIVER=ewelink. Con este
// driver el sistema "cree" que controla las máquinas pero no prende nada real;
// por eso registra en consola cada operación para que sea evidente.

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

// Solo para pruebas: reinicia el estado simulado.
export function _reset() {
  estados.clear();
}
