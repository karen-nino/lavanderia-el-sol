/**
 * Credenciales OAuth de eWeLink: conseguir y renovar el token que usa el driver.
 * Es OAuth porque el plan gratuito no permite POST /v2/user/login ("407 the path
 * of request is not allowed with appid").
 *
 * Flujo:
 * 1. urlAutorizacion(state): la dueña de la cuenta abre la página y acepta.
 * 2. eWeLink redirige al callback con ?code&region&state.
 * 3. canjearCode(code, region): accessToken (30 días) + refreshToken.
 * 4. refrescarToken(rt, region) antes de que venza.
 *
 * Variables: EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_REDIRECT_URL (idéntica a
 * la registrada en eWeLink) y EWELINK_REGION (por defecto "us").
 */

import crypto from 'crypto';

export const BASES = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};

const REDIRECT_URL_DEF = 'https://lavanderia-el-sol-api.fly.dev/api/ewelink/callback';

export const cfg = {
  appId: process.env.EWELINK_APP_ID,
  appSecret: process.env.EWELINK_APP_SECRET,
  redirectUrl: process.env.EWELINK_REDIRECT_URL || REDIRECT_URL_DEF,
  region: (process.env.EWELINK_REGION || 'us').toLowerCase(),
};

export const configCompleta = () => Boolean(cfg.appId && cfg.appSecret);

export const baseDe = (region) => BASES[(region || cfg.region || 'us').toLowerCase()] || BASES.us;

export const nonce = () =>
  crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).padEnd(8, '0');

/** HMAC-SHA256 con el appSecret, en base64, del cuerpo exacto o de la cadena dada. */
export const firmar = (texto) =>
  crypto.createHmac('sha256', cfg.appSecret).update(texto).digest('base64');

/**
 * Petición a la API de eWeLink. Ojo: el Content-Type tiene que ser exactamente
 * "application/json" o "application/json; charset=utf-8"; otra forma da 400.
 */
export async function apiFetch(base, path, { method = 'GET', headers = {}, bodyStr, query } = {}) {
  let url = `${base}${path}`;
  if (query) url += `?${new URLSearchParams(query).toString()}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CK-Appid': cfg.appId, ...headers },
    body: bodyStr,
  });
  return resp.json();
}

/**
 * URL donde la dueña de la cuenta autoriza la app. Se firma "<appId>_<seq>" y
 * los valores van escapados: una firma con '+' sin escapar falla a veces
 * ("sign verification failed"). `showQRCode` se omite a propósito.
 */
export function urlAutorizacion(state) {
  const seq = Date.now().toString();
  const params = {
    clientId: cfg.appId,
    redirectUrl: cfg.redirectUrl,
    grantType: 'authorization_code',
    state,
    nonce: nonce(),
    seq,
    authorization: firmar(`${cfg.appId}_${seq}`),
  };
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://c2ccdn.coolkit.cc/oauth/index.html?${query}`;
}

/** Normaliza la respuesta de ambos trámites (accessToken/at, refreshToken/rt). */
function leerTokens(data, region) {
  const d = data?.data ?? {};
  const at = d.accessToken ?? d.at;
  const rt = d.refreshToken ?? d.rt;
  if (!at || !rt) return null;
  return {
    accessToken: at,
    refreshToken: rt,
    region: (d.region || region || cfg.region).toLowerCase(),
    cuenta: d.user?.email ?? d.user?.phoneNumber ?? null,
    // En ms; si faltan, los plazos documentados (30 y 60 días).
    atExpiraAt: d.atExpiredTime ? new Date(d.atExpiredTime) : new Date(Date.now() + 30 * 86400e3),
    rtExpiraAt: d.rtExpiredTime ? new Date(d.rtExpiredTime) : new Date(Date.now() + 60 * 86400e3),
  };
}

/** Canjea el `code` del redirect por los tokens. Lanza con un mensaje para la pantalla. */
export async function canjearCode(code, region) {
  const cuerpo = { redirectUrl: cfg.redirectUrl, code, grantType: 'authorization_code' };
  const cuerpoStr = JSON.stringify(cuerpo);
  const data = await apiFetch(baseDe(region), '/v2/user/oauth/token', {
    method: 'POST',
    bodyStr: cuerpoStr,
    headers: { Authorization: `Sign ${firmar(cuerpoStr)}`, 'X-CK-Nonce': nonce() },
  });
  const tokens = leerTokens(data, region);
  if (data?.error !== 0 || !tokens) {
    throw new Error(`eWeLink rechazó el código (error ${data?.error}: ${data?.msg || 'sin detalle'})`);
  }
  return tokens;
}

/** Renueva el access token. */
export async function refrescarToken(refreshToken, region) {
  const cuerpo = { rt: refreshToken };
  const cuerpoStr = JSON.stringify(cuerpo);
  const data = await apiFetch(baseDe(region), '/v2/user/refresh', {
    method: 'POST',
    bodyStr: cuerpoStr,
    headers: { Authorization: `Sign ${firmar(cuerpoStr)}`, 'X-CK-Nonce': nonce() },
  });
  const tokens = leerTokens(data, region);
  if (data?.error !== 0 || !tokens) {
    throw new Error(`no se pudo renovar el token (error ${data?.error}: ${data?.msg || 'sin detalle'})`);
  }
  // El refresh no trae la cuenta; se conserva la guardada.
  return { ...tokens, cuenta: null };
}
