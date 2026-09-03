// ewelinkDriver — control real de los Sonoff a través de la nube eWeLink (API v2).
//
// Autenticación: el token sale de la sesión OAuth que guardó `ewelinkCuenta`
// (ver `ewelinkOAuth.js` para el porqué de OAuth y no correo/contraseña). El
// driver solo lo usa y lo renueva cuando está por vencer; conectar la cuenta la
// primera vez es cosa del endpoint /api/ewelink/conectar.
//
// Control: POST /v2/device/thing/status con { type:1, id, params:{switch} }.
// Lectura: GET /v2/device/thing/status?type=1&id=..&params=switch.
// Sonoff multi-relé: se usa params.switches[{switch, outlet}] según device_canal.
//
// Todas las funciones devuelven { ok, estado, motivo } y NUNCA lanzan: un fallo
// de red/nube se refleja como ok:false para que sonoff_estado quede en 'error'.
// El motivo viaja hasta la pantalla, así que distingue los casos que se arreglan
// distinto: 'sin_cuenta_conectada' (falta autorizar) no es lo mismo que
// 'ewelink_<código>' (la nube rechazó la operación).

import { apiFetch, baseDe, nonce, configCompleta, refrescarToken } from './ewelinkOAuth.js';

const NO_CONFIGURADO = { ok: false, estado: null, motivo: 'ewelink_no_configurado' };
const ERROR_RED = (motivo = 'error_red') => ({ ok: false, estado: null, motivo });

// Margen para renovar el access token antes de que caduque de verdad. Con 30
// días de vida, renovar un día antes evita la carrera de que expire entre que
// se lee y se usa.
const MARGEN_RENOVACION_MS = 24 * 60 * 60 * 1000;

// De dónde se leen y guardan los tokens. Se carga tarde (y se puede sustituir)
// para que las pruebas del driver no arrastren la conexión a la base.
let store = null;
export function _setStore(nuevo) {
  store = nuevo;
  sesion = null;
}
async function getStore() {
  if (!store) store = await import('./ewelinkCuenta.js');
  return store;
}

// Token en memoria para no ir a la base en cada encendido: { at, base }.
let sesion = null;

class SinCuenta extends Error {
  constructor(motivo) {
    super(motivo);
    this.motivo = motivo;
  }
}

// Devuelve un token utilizable, renovándolo si hace falta.
async function asegurarSesion() {
  if (sesion?.at) return sesion;

  const s = await getStore();
  const cuenta = await s.leerCuenta();
  if (!s.estaConectada(cuenta)) {
    // Sin cuenta autorizada (o con el refresh token ya vencido) no hay nada que
    // renovar: alguien tiene que volver a conectar la cuenta a mano.
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

// Fuerza una renovación cuando la nube dice que el token no sirve, aunque
// nuestras fechas digan que todavía estaba vigente (pasa si el cliente revoca
// el permiso y lo vuelve a dar, o si eWeLink lo invalida antes de tiempo).
async function renovarPorRechazo() {
  const s = await getStore();
  const cuenta = await s.leerCuenta();
  if (!s.estaConectada(cuenta)) throw new SinCuenta('sin_cuenta_conectada');
  const tokens = await refrescarToken(cuenta.refresh_token, cuenta.region);
  const guardada = await s.guardarTokens(tokens);
  sesion = { at: guardada.access_token, base: baseDe(guardada.region) };
  return sesion;
}

// 401xx/402 = token inválido o expirado del lado de eWeLink.
const esErrorDeAuth = (error) =>
  error === 402 || error === 401 || String(error).startsWith('401');

// Llama a un endpoint autenticado; si el token es rechazado, lo renueva y
// reintenta una vez.
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

// Construye los params de switch respetando el canal (multi-relé).
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

// Solo para pruebas: limpia la sesión cacheada.
export function _reset() {
  sesion = null;
}
