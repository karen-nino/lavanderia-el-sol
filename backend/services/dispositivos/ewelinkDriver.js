/**
 * Control real de los Sonoff por la nube eWeLink (API v2). Usa y renueva el
 * token OAuth guardado; conectar la cuenta es de /api/ewelink/conectar.
 * - Control: POST /v2/device/thing/status { type: 1, id, params: { switch } }.
 * - Lectura: GET /v2/device/thing/status?type=1&id=..&params=switch.
 * - Multi-relé: params.switches [{ switch, outlet }] según device_canal.
 * - Lectura en lote (barrido): POST /v2/device/thing { thingList } — una llamada
 *   por cada 10 Sonoff en vez de una por máquina.
 * - Límite de llamadas (error 412 "invoke too much"): se deja de llamar a la nube
 *   un rato (LIMITE_PAUSA_MINUTOS); seguir intentando solo gasta más.
 *
 * Nunca lanza: devuelve { ok, estado, motivo }. El motivo llega a la pantalla y
 * distingue, p. ej., 'sin_cuenta_conectada' de 'ewelink_<código>'.
 */

import { apiFetch, baseDe, nonce, configCompleta, refrescarToken } from './ewelinkOAuth.js';

const NO_CONFIGURADO = { ok: false, estado: null, motivo: 'ewelink_no_configurado' };
const ERROR_RED = (motivo = 'error_red') => ({ ok: false, estado: null, motivo });

/** Código de eWeLink cuando la app pasó su límite de llamadas ("invoke too much"). */
const CODIGO_LIMITE = 412;
const LIMITE = { ok: false, estado: null, motivo: 'ewelink_limite' };

/** Minutos sin llamar a la nube después de un 412 (30 por defecto). */
export const LIMITE_PAUSA_MINUTOS = (() => {
  const m = Number(process.env.SONOFF_LIMITE_PAUSA_MINUTOS);
  return Number.isFinite(m) && m > 0 ? m : 30;
})();

/** Hasta cuándo (epoch ms) no se llama a la nube por el límite. */
let limiteHasta = 0;

/** ¿Está en pausa por el límite de llamadas? */
export const enPausaPorLimite = () => Date.now() < limiteHasta;

/** Si el error es el del límite, arranca la pausa. Devuelve si lo era. */
function registrarLimite(error) {
  if (Number(error) !== CODIGO_LIMITE) return false;
  if (!enPausaPorLimite()) {
    console.warn(`[dispositivos:ewelink] se acabó el límite de llamadas: pausa de ${LIMITE_PAUSA_MINUTOS} min.`);
  }
  limiteHasta = Date.now() + LIMITE_PAUSA_MINUTOS * 60 * 1000;
  return true;
}

/**
 * Estados leídos en lote por el barrido, por device_id: { params, online, at }.
 * `estado()` los usa una vez y solo si son recientes; si no, pregunta al Sonoff.
 */
const precargados = new Map();
const VIGENCIA_PRECARGA_MS = 90 * 1000;

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
  if (enPausaPorLimite()) return LIMITE;
  try {
    const data = await llamarAuth('/v2/device/thing/status', {
      method: 'POST',
      bodyStr: JSON.stringify({ type: 1, id: maquina.device_id, params: paramsSwitch(maquina, on) }),
    });
    if (data?.error !== 0) {
      console.warn(`[dispositivos:ewelink] set switch device=${maquina.device_id} error ${data?.error}: ${data?.msg}`);
      if (registrarLimite(data?.error)) return LIMITE;
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

/** 'on' | 'off' del relé de la máquina en unos params de eWeLink (o undefined). */
function valorSwitch(maquina, p = {}) {
  if (maquina.device_canal != null) {
    const item = Array.isArray(p.switches)
      ? p.switches.find((s) => Number(s.outlet) === Number(maquina.device_canal))
      : null;
    return item?.switch;
  }
  return p.switch;
}

/**
 * Lee de una vez el estado de varios Sonoff (de 10 en 10) para que el barrido no
 * haga una llamada por máquina. Lo que no llegue se pregunta uno por uno después.
 * No lanza.
 */
export async function precargarEstados(maquinas) {
  if (!configCompleta() || enPausaPorLimite()) return;
  const ids = [...new Set(maquinas.map((m) => m.device_id).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 10) {
    if (enPausaPorLimite()) return;
    const lote = ids.slice(i, i + 10);
    try {
      const data = await llamarAuth('/v2/device/thing', {
        method: 'POST',
        bodyStr: JSON.stringify({ thingList: lote.map((id) => ({ itemType: 1, id })) }),
      });
      if (data?.error !== 0) {
        console.warn(`[dispositivos:ewelink] lectura en lote error ${data?.error}: ${data?.msg}`);
        registrarLimite(data?.error);
        continue;
      }
      const ahora = Date.now();
      for (const t of data?.data?.thingList ?? []) {
        const d = t?.itemData;
        if (!d?.deviceid || !lote.includes(d.deviceid)) continue;
        precargados.set(d.deviceid, { params: d.params ?? {}, online: d.online !== false, at: ahora });
      }
    } catch (err) {
      console.warn('[dispositivos:ewelink] lectura en lote excepción:', err.message);
    }
  }
}

/**
 * Lo leído en lote para la máquina, sin llamar a la nube ni gastarlo: { ok, estado }
 * o null si no hay lectura reciente.
 */
export function leidoEnLote(maquina) {
  const previo = precargados.get(maquina?.device_id);
  if (!previo || Date.now() - previo.at >= VIGENCIA_PRECARGA_MS) return null;
  if (!previo.online) return ERROR_RED('fuera_de_linea');
  const valor = valorSwitch(maquina, previo.params);
  return valor === 'on' || valor === 'off' ? { ok: true, estado: valor } : null;
}

export async function estado(maquina) {
  if (!configCompleta()) return NO_CONFIGURADO;
  // Lo leído en lote por el barrido, si es reciente (se usa una sola vez).
  const previo = precargados.get(maquina.device_id);
  precargados.delete(maquina.device_id);
  if (previo && Date.now() - previo.at < VIGENCIA_PRECARGA_MS) {
    if (!previo.online) return ERROR_RED('fuera_de_linea');
    const valor = valorSwitch(maquina, previo.params);
    if (valor === 'on' || valor === 'off') return { ok: true, estado: valor };
  }
  if (enPausaPorLimite()) return LIMITE;
  try {
    const multi = maquina.device_canal != null;
    const data = await llamarAuth('/v2/device/thing/status', {
      method: 'GET',
      query: { type: '1', id: maquina.device_id, params: multi ? 'switches' : 'switch' },
    });
    if (data?.error !== 0) {
      console.warn(`[dispositivos:ewelink] get status device=${maquina.device_id} error ${data?.error}: ${data?.msg}`);
      if (registrarLimite(data?.error)) return LIMITE;
      return ERROR_RED(`ewelink_${data?.error}`);
    }
    const valor = valorSwitch(maquina, data?.data?.params ?? {});
    if (valor !== 'on' && valor !== 'off') return ERROR_RED('estado_desconocido');
    return { ok: true, estado: valor };
  } catch (err) {
    console.warn(`[dispositivos:ewelink] get status device=${maquina.device_id} excepción:`, err.message);
    return ERROR_RED(err.motivo);
  }
}

/** Solo para pruebas: limpia la sesión en memoria, la pausa por límite y lo precargado. */
export function _reset() {
  sesion = null;
  limiteHasta = 0;
  precargados.clear();
}
