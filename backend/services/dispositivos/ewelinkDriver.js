/**
 * Control real de los Sonoff por la nube eWeLink (API v2). Usa y renueva el
 * token OAuth guardado; conectar la cuenta es de /api/ewelink/conectar.
 * - Control: POST /v2/device/thing/status { type: 1, id, params: { switch } }.
 * - Lectura: GET /v2/device/thing/status?type=1&id=..&params=switch.
 * - Multi-relé: params.switches [{ switch, outlet }] según device_canal.
 *
 * Nunca lanza: devuelve { ok, estado, motivo }. El motivo llega a la pantalla y
 * distingue, p. ej., 'sin_cuenta_conectada' de 'ewelink_<código>'.
 */

import { apiFetch, baseDe, nonce, configCompleta, refrescarToken } from './ewelinkOAuth.js';

const NO_CONFIGURADO = { ok: false, estado: null, motivo: 'ewelink_no_configurado' };
const ERROR_RED = (motivo = 'error_red') => ({ ok: false, estado: null, motivo });

/** Se renueva un día antes de que caduque. */
const MARGEN_RENOVACION_MS = 24 * 60 * 60 * 1000;

/** Almacén de tokens; se carga tarde y es sustituible en pruebas. */
let store = null;
export function _setStore(nuevo) {
  store = nuevo;
  sesion = null;
}
async function getStore() {
  if (!store) store = await import('./ewelinkCuenta.js');
  return store;
}

/** Token en memoria ({ at, base }) para no leer la base en cada encendido. */
let sesion = null;

class SinCuenta extends Error {
  constructor(motivo) {
    super(motivo);
    this.motivo = motivo;
  }
}

/** Token utilizable, renovándolo si hace falta. */
async function asegurarSesion() {
  if (sesion?.at) return sesion;

  const s = await getStore();
  const cuenta = await s.leerCuenta();
  if (!s.estaConectada(cuenta)) {
    // Sin cuenta o con el refresh vencido: hay que reconectar a mano.
    throw new SinCuenta(cuenta?.access_token ? 'sesion_expirada' : 'sin_cuenta_conectada');
  }

  const porVencer =
    !cuenta.at_expira_at || new Date(cuenta.at_expira_at).getTime() - Date.now() < MARGEN_RENOVACION_MS;

  if (porVencer) {
    const tokens = await refrescarToken(cuenta.refresh_token, cuenta.region);
    const guardada = await s.guardarTokens(tokens);
    sesion = { at: guardada.access_token, base: baseDe(guardada.region) };
    return sesion;
  }

  sesion = { at: cuenta.access_token, base: baseDe(cuenta.region) };
  return sesion;
}

/** Renueva cuando la nube rechaza un token que según nuestras fechas seguía vigente. */
async function renovarPorRechazo() {
  const s = await getStore();
  const cuenta = await s.leerCuenta();
  if (!s.estaConectada(cuenta)) throw new SinCuenta('sin_cuenta_conectada');
  const tokens = await refrescarToken(cuenta.refresh_token, cuenta.region);
  const guardada = await s.guardarTokens(tokens);
  sesion = { at: guardada.access_token, base: baseDe(guardada.region) };
  return sesion;
}

/** 401xx/402: token inválido o expirado según eWeLink. */
const esErrorDeAuth = (error) =>
  error === 402 || error === 401 || String(error).startsWith('401');

/** Llama a un endpoint autenticado; si rechaza el token, lo renueva y reintenta una vez. */
async function llamarAuth(path, opts, reintento = true) {
  const s = await asegurarSesion();
  const data = await apiFetch(s.base, path, {
    ...opts,
    headers: { Authorization: `Bearer ${s.at}`, 'X-CK-Nonce': nonce() },
  });
  if (reintento && esErrorDeAuth(data?.error)) {
    sesion = null;
    await renovarPorRechazo();
    return llamarAuth(path, opts, false);
  }
  return data;
}

/** Params de switch según el canal (multi-relé). */
function paramsSwitch(maquina, on) {
  const valor = on ? 'on' : 'off';
  if (maquina.device_canal != null) {
    return { switches: [{ switch: valor, outlet: Number(maquina.device_canal) }] };
  }
  return { switch: valor };
}

async function setSwitch(maquina, on) {
  if (!configCompleta()) return NO_CONFIGURADO;
  try {
    const data = await llamarAuth('/v2/device/thing/status', {
      method: 'POST',
      bodyStr: JSON.stringify({ type: 1, id: maquina.device_id, params: paramsSwitch(maquina, on) }),
    });
    if (data?.error !== 0) {
      console.warn(`[dispositivos:ewelink] set switch device=${maquina.device_id} error ${data?.error}: ${data?.msg}`);
      return ERROR_RED(`ewelink_${data?.error}`);
    }
    return { ok: true, estado: on ? 'on' : 'off' };
  } catch (err) {
    console.warn(`[dispositivos:ewelink] set switch device=${maquina.device_id} excepción:`, err.message);
    return ERROR_RED(err.motivo);
  }
}

export async function encender(maquina) {
  return setSwitch(maquina, true);
}

export async function apagar(maquina) {
  return setSwitch(maquina, false);
}

export async function estado(maquina) {
  if (!configCompleta()) return NO_CONFIGURADO;
  try {
    const multi = maquina.device_canal != null;
    const data = await llamarAuth('/v2/device/thing/status', {
      method: 'GET',
      query: { type: '1', id: maquina.device_id, params: multi ? 'switches' : 'switch' },
    });
    if (data?.error !== 0) {
      console.warn(`[dispositivos:ewelink] get status device=${maquina.device_id} error ${data?.error}: ${data?.msg}`);
      return ERROR_RED(`ewelink_${data?.error}`);
    }
    const p = data?.data?.params ?? {};
    let valor;
    if (multi) {
      const item = Array.isArray(p.switches)
        ? p.switches.find((s) => Number(s.outlet) === Number(maquina.device_canal))
        : null;
      valor = item?.switch;
    } else {
      valor = p.switch;
    }
    if (valor !== 'on' && valor !== 'off') return ERROR_RED('estado_desconocido');
    return { ok: true, estado: valor };
  } catch (err) {
    console.warn(`[dispositivos:ewelink] get status device=${maquina.device_id} excepción:`, err.message);
    return ERROR_RED(err.motivo);
  }
}

/** Solo para pruebas: limpia la sesión en memoria. */
export function _reset() {
  sesion = null;
}
