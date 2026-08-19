// ewelinkDriver — control real de los Sonoff a través de la nube eWeLink (API v2).
//
// Autenticación: POST /v2/user/login firmado con HMAC-SHA256(appSecret) sobre el
// cuerpo exacto (header "Authorization: Sign <base64>"). Devuelve un access
// token (at) que se cachea en memoria y se reusa; si una llamada da error de
// auth, se vuelve a iniciar sesión una vez.
//
// Control: POST /v2/device/thing/status con { type:1, id, params:{switch} }.
// Lectura: GET /v2/device/thing/status?type=1&id=..&params=switch.
// Sonoff multi-relé: se usa params.switches[{switch, outlet}] según device_canal.
//
// Todas las funciones devuelven { ok, estado, motivo } y NUNCA lanzan: un fallo
// de red/nube se refleja como ok:false para que sonoff_estado quede en 'error'.
//
// Config por variables de entorno:
//   EWELINK_APP_ID, EWELINK_APP_SECRET   — credenciales de dev.ewelink.cc
//   EWELINK_EMAIL o EWELINK_PHONE        — cuenta donde están los Sonoff
//   EWELINK_PASSWORD
//   EWELINK_COUNTRY_CODE                 — ej. "+52" (México). Default "+52".
//   EWELINK_REGION                       — us | eu | as | cn. Default "us".

import crypto from 'crypto';

const BASES = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};

const cfg = {
  appId: process.env.EWELINK_APP_ID,
  appSecret: process.env.EWELINK_APP_SECRET,
  email: process.env.EWELINK_EMAIL,
  phone: process.env.EWELINK_PHONE,
  password: process.env.EWELINK_PASSWORD,
  countryCode: process.env.EWELINK_COUNTRY_CODE || '+52',
  region: (process.env.EWELINK_REGION || 'us').toLowerCase(),
};

function configCompleta() {
  return Boolean(cfg.appId && cfg.appSecret && cfg.password && (cfg.email || cfg.phone));
}

const NO_CONFIGURADO = { ok: false, estado: null, motivo: 'ewelink_no_configurado' };
const ERROR_RED = (motivo = 'error_red') => ({ ok: false, estado: null, motivo });

// Token cacheado en memoria: { at, base }.
let sesion = null;

const nonce = () =>
  crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).padEnd(8, '0');

const firmar = (cuerpoStr) =>
  crypto.createHmac('sha256', cfg.appSecret).update(cuerpoStr).digest('base64');

async function baseFetch(base, path, { method = 'GET', headers = {}, bodyStr, query } = {}) {
  let url = `${base}${path}`;
  if (query) url += `?${new URLSearchParams(query).toString()}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', 'X-CK-Appid': cfg.appId, ...headers },
    body: bodyStr,
  });
  return resp.json();
}

// Inicia sesión y cachea el token. Maneja el redirect de región (error 10004).
async function login() {
  const cuerpo = { password: cfg.password, countryCode: cfg.countryCode };
  if (cfg.email) cuerpo.email = cfg.email; else cuerpo.phoneNumber = cfg.phone;
  const cuerpoStr = JSON.stringify(cuerpo);
  const headers = { Authorization: `Sign ${firmar(cuerpoStr)}`, 'X-CK-Nonce': nonce() };

  let base = BASES[cfg.region] || BASES.us;
  let data = await baseFetch(base, '/v2/user/login', { method: 'POST', headers, bodyStr: cuerpoStr });

  // Región equivocada: eWeLink devuelve la correcta; reintentar una vez.
  if (data?.error === 10004 && data?.data?.region && BASES[data.data.region]) {
    base = BASES[data.data.region];
    data = await baseFetch(base, '/v2/user/login', { method: 'POST', headers, bodyStr: cuerpoStr });
  }

  if (data?.error !== 0 || !data?.data?.at) {
    throw new Error(`login eWeLink falló (error ${data?.error}: ${data?.msg || 'sin detalle'})`);
  }
  sesion = { at: data.data.at, base };
  return sesion;
}

async function asegurarSesion() {
  if (sesion?.at) return sesion;
  return login();
}

// Llama a un endpoint autenticado; si da error de auth, re-login y reintenta 1 vez.
async function llamarAuth(path, opts, reintento = true) {
  const s = await asegurarSesion();
  const data = await baseFetch(s.base, path, {
    ...opts,
    headers: { Authorization: `Bearer ${s.at}`, 'X-CK-Nonce': nonce() },
  });
  // 401xx = token inválido/expirado.
  if (reintento && (data?.error === 401 || String(data?.error).startsWith('401'))) {
    sesion = null;
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
      return ERROR_RED();
    }
    return { ok: true, estado: on ? 'on' : 'off' };
  } catch (err) {
    console.warn(`[dispositivos:ewelink] set switch device=${maquina.device_id} excepción:`, err.message);
    return ERROR_RED();
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
      return ERROR_RED();
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
    return ERROR_RED();
  }
}

// Solo para pruebas: limpia la sesión cacheada.
export function _reset() {
  sesion = null;
}
