// ewelinkOAuth — el trámite de credenciales con eWeLink, aparte del control de
// dispositivos. Aquí no se enciende nada: solo se consigue y se renueva el
// token que el driver usará después.
//
// Por qué OAuth y no correo/contraseña: la credencial del plan gratuito
// (Personal Developer) no tiene permiso sobre POST /v2/user/login — responde
// "407 the path of request is not allowed with appid". Su lista blanca sí
// incluye /v2/user/oauth/token y /v2/user/refresh, que son estos dos trámites.
//
// El flujo completo:
//   1. urlAutorizacion(state) → la dueña de la cuenta abre esa página y acepta.
//   2. eWeLink redirige a nuestro callback con ?code=..&region=..&state=..
//   3. canjearCode(code, region) → accessToken (30 días) + refreshToken.
//   4. refrescarToken(rt, region) cuando el access token está por vencer.
//
// Config por variables de entorno:
//   EWELINK_APP_ID, EWELINK_APP_SECRET  — credenciales de dev.ewelink.cc
//   EWELINK_REDIRECT_URL                — debe coincidir EXACTO con la Redirect
//                                         URL registrada en el panel de eWeLink
//   EWELINK_REGION                      — región inicial. Default "us".

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

// HMAC-SHA256 con el appSecret, en base64. Sobre el cuerpo JSON exacto que se
// manda (los trámites de token) o sobre una cadena suelta (la URL de login).
export const firmar = (texto) =>
  crypto.createHmac('sha256', cfg.appSecret).update(texto).digest('base64');

// Petición a la API de eWeLink.
//
// OJO con el Content-Type: eWeLink valida la cadena EXACTA y solo acepta
// "application/json" o "application/json; charset=utf-8". Cualquier otra forma
// (p. ej. "application/json;charset=UTF-8", sin espacio) se rechaza con un
// error 400 ANTES de mirar la firma o las credenciales.
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

// Página donde la dueña de la cuenta inicia sesión y autoriza la app.
//
// La firma aquí NO es sobre un cuerpo JSON sino sobre la cadena "<appId>_<seq>".
//
// Los valores VAN ESCAPADOS, a diferencia de la librería oficial de CoolKit
// (ewelink-api-next), que los concatena crudos. La firma es base64 y puede
// contener '+', que sin escapar se lee como un espacio al otro lado: la firma
// deja de coincidir y eWeLink responde "sign verification failed" —el error que
// reporta media docena de gente en su foro— pero solo a veces, según si a esa
// firma le tocó un '+'. Escaparlos lo vuelve determinista.
//
// `showQRCode` se omite a propósito: la librería lo manda como "null" literal,
// que en la página es una cadena no vacía y podría leerse como verdadero.
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

// Normaliza lo que devuelven ambos trámites: eWeLink usa nombres distintos para
// lo mismo (accessToken/at, refreshToken/rt) según el endpoint.
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
    // Los tiempos vienen en milisegundos desde época. Si faltaran, se asumen
    // los plazos que documenta eWeLink: 30 días el access, 60 el refresh.
    atExpiraAt: d.atExpiredTime ? new Date(d.atExpiredTime) : new Date(Date.now() + 30 * 86400e3),
    rtExpiraAt: d.rtExpiredTime ? new Date(d.rtExpiredTime) : new Date(Date.now() + 60 * 86400e3),
  };
}

// Cambia el `code` del redirect por el par de tokens.
// Lanza con mensaje legible: quien llama lo muestra en pantalla.
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

// Renueva el access token sin volver a molestar al cliente.
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
  // El refresh no devuelve el usuario; se conserva el que ya estaba guardado.
  return { ...tokens, cuenta: null };
}
