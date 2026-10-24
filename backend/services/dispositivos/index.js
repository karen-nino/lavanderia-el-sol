/**
 * Punto único para encender, apagar y leer una máquina física, sin importar el
 * driver de abajo.
 *
 * Interfaz: encender | apagar | estado (maquina) → { ok, estado: 'on'|'off'|null, motivo? }.
 * ok=false trae el motivo ('sin_enlazar', 'error_red'…), que decide sonoff_estado.
 *
 * DISPOSITIVOS_DRIVER: 'ewelink' (nube real) o cualquier otro valor/ausente =
 * simulación en memoria (nullDriver).
 * DISPOSITIVOS_SUCURSALES (opcional): slugs separados por comas; con el driver
 * real, solo esas sucursales usan los Sonoff y las demás se simulan. Vacía = todas.
 */

import * as nullDriver from './nullDriver.js';
import * as ewelinkDriver from './ewelinkDriver.js';

const NOMBRE_DRIVER = (process.env.DISPOSITIVOS_DRIVER || 'null').toLowerCase();

/** Se lee en cada llamada para que las pruebas la puedan cambiar. */
const sucursalesReales = () => String(process.env.DISPOSITIVOS_SUCURSALES ?? '')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

/** ¿Esta sucursal usa los Sonoff reales? */
export const esRealEnSucursal = (sucursal) => {
  if (NOMBRE_DRIVER !== 'ewelink') return false;
  const lista = sucursalesReales();
  return lista.length === 0 || lista.includes(String(sucursal ?? '').toLowerCase());
};

const driverDe = (maquina) => (esRealEnSucursal(maquina?.sucursal) ? ewelinkDriver : nullDriver);

/** ¿Tiene Sonoff enlazado (device_id)? */
export const tieneDispositivo = (maquina) => Boolean(maquina && maquina.device_id);

const SIN_ENLAZAR = { ok: false, estado: null, motivo: 'sin_enlazar' };

/** Driver de la máquina (según su sucursal) o, sin máquina, el configurado. */
export const nombreDriver = (maquina) => {
  if (maquina !== undefined) return esRealEnSucursal(maquina?.sucursal) ? 'ewelink' : 'null';
  return NOMBRE_DRIVER === 'ewelink' ? 'ewelink' : 'null';
};

/**
 * ¿Esta máquina se simula? En simulación todo responde ok, así que no se debe
 * marcar 'enlazada'. Se pregunta por máquina: unas pueden ser reales y otras no.
 */
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

/**
 * Antes del barrido: lee en lote las máquinas con Sonoff real (una llamada por
 * cada 10). No lanza.
 */
export async function precargarEstados(maquinas = []) {
  const reales = maquinas.filter((m) => tieneDispositivo(m) && !esSimulacion(m));
  if (reales.length > 0) await ewelinkDriver.precargarEstados(reales);
}

/** ¿La nube de eWeLink está en pausa porque se acabó el límite de llamadas? */
export const enPausaPorLimite = () => NOMBRE_DRIVER === 'ewelink' && ewelinkDriver.enPausaPorLimite();

/** Lo leído en lote por el barrido para esta máquina, o null (no llama a la nube). */
export const leidoEnLote = (maquina) =>
  (tieneDispositivo(maquina) && !esSimulacion(maquina) ? ewelinkDriver.leidoEnLote(maquina) : null);
