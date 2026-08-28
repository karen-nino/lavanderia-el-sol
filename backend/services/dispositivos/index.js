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

import * as nullDriver from './nullDriver.js';
import * as ewelinkDriver from './ewelinkDriver.js';

const NOMBRE_DRIVER = (process.env.DISPOSITIVOS_DRIVER || 'null').toLowerCase();
const driver = NOMBRE_DRIVER === 'ewelink' ? ewelinkDriver : nullDriver;

// ¿La máquina tiene un Sonoff enlazado? Sin device_id no hay nada que controlar.
export const tieneDispositivo = (maquina) => Boolean(maquina && maquina.device_id);

const SIN_ENLAZAR = { ok: false, estado: null, motivo: 'sin_enlazar' };

export const nombreDriver = () => NOMBRE_DRIVER === 'ewelink' ? 'ewelink' : 'null';

// ¿Estamos simulando? Con el driver 'null' toda operación responde ok sin tocar
// hardware, así que un resultado exitoso NO significa que el Sonoff exista ni
// responda. Quien guarde o muestre "enlazada" debe consultarlo antes: marcar el
// enlace como confirmado en simulación sería mentirle a quien instala.
export const esSimulacion = () => nombreDriver() !== 'ewelink';

export async function encender(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driver.encender(maquina);
}

export async function apagar(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driver.apagar(maquina);
}

export async function estado(maquina) {
  if (!tieneDispositivo(maquina)) return SIN_ENLAZAR;
  return driver.estado(maquina);
}
