// Capa "driver de dispositivos" — punto único por donde el resto del sistema
// enciende/apaga una máquina física, sin saber si por debajo es la nube
// eWeLink o (en el futuro) control local en la red de la lavandería.
//
// Interfaz común (todos los drivers la implementan):
//   encender(maquina) -> Resultado
//   apagar(maquina)   -> Resultado
//   estado(maquina)   -> Resultado   (estado: 'on' | 'off' | null)
//
// Resultado = { ok: boolean, estado: 'on'|'off'|null, motivo?: string }
//   ok=true  → el driver confirmó la operación / lectura.
//   ok=false → no se pudo (con motivo: 'sin_enlazar', 'driver_deshabilitado',
//              'ewelink_no_configurado', 'error_red', ...). El servicio de
//              sincronización usa esto para decidir el sonoff_estado.
//
// El driver se elige con la variable de entorno DISPOSITIVOS_DRIVER:
//   'ewelink' → nube eWeLink (real).
//   cualquier otro valor / ausente → nullDriver (simulación en memoria, sin
//   hardware; sirve para desarrollo y pruebas).
//
// DISPOSITIVOS_SUCURSALES (opcional, 2026-10-09): lista de slugs separada por
// comas (p. ej. `zapopan`). Con el driver real, SOLO las máquinas de
// esas sucursales hablan con los Sonoff; las demás siguen simuladas, como si
// el driver fuera 'null'. Sirve para probar en una sucursal sin tocar las
// otras. Vacía o ausente = todas las sucursales (el comportamiento de antes).

import * as nullDriver from './nullDriver.js';
import * as ewelinkDriver from './ewelinkDriver.js';

const NOMBRE_DRIVER = (process.env.DISPOSITIVOS_DRIVER || 'null').toLowerCase();

// Se lee en cada llamada para que las pruebas la puedan cambiar.
const sucursalesReales = () => String(process.env.DISPOSITIVOS_SUCURSALES ?? '')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

// ¿Esta sucursal usa los Sonoff reales?
export const esRealEnSucursal = (sucursal) => {
  if (NOMBRE_DRIVER !== 'ewelink') return false;
  const lista = sucursalesReales();
  return lista.length === 0 || lista.includes(String(sucursal ?? '').toLowerCase());
};

const driverDe = (maquina) => (esRealEnSucursal(maquina?.sucursal) ? ewelinkDriver : nullDriver);

// ¿La máquina tiene un Sonoff enlazado? Sin device_id no hay nada que controlar.
export const tieneDispositivo = (maquina) => Boolean(maquina && maquina.device_id);

const SIN_ENLAZAR = { ok: false, estado: null, motivo: 'sin_enlazar' };

// Con `maquina`, el driver que de verdad le toca (su sucursal puede estar fuera
// de DISPOSITIVOS_SUCURSALES); sin ella, el configurado en el servidor.
export const nombreDriver = (maquina) => {
  if (maquina !== undefined) return esRealEnSucursal(maquina?.sucursal) ? 'ewelink' : 'null';
  return NOMBRE_DRIVER === 'ewelink' ? 'ewelink' : 'null';
};

// ¿Estamos simulando? Con el driver 'null' toda operación responde ok sin tocar
// hardware, así que un resultado exitoso NO significa que el Sonoff exista ni
// responda. Quien guarde o muestre "enlazada" debe consultarlo antes: marcar el
// enlace como confirmado en simulación sería mentirle a quien instala.
// Siempre se pregunta POR MÁQUINA: con DISPOSITIVOS_SUCURSALES una puede ser
// real y otra simulada en el mismo servidor.
export const esSimulacion = (maquina) => nombreDriver(maquina) !== 'ewelink';

export async function encender(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driverDe(maquina).encender(maquina);
}

export async function apagar(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driverDe(maquina).apagar(maquina);
}

export async function estado(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driverDe(maquina).estado(maquina);
}
