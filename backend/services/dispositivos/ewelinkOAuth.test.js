import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

const ENV_OK = {
  EWELINK_APP_ID: 'app123',
  EWELINK_APP_SECRET: 'secret123',
  EWELINK_REGION: 'us',
  EWELINK_REDIRECT_URL: 'https://api.ejemplo.com/api/ewelink/callback',
};

function setEnv(env) {
  for (const k of Object.keys(ENV_OK)) delete process.env[k];
  Object.assign(process.env, env);
}

async function cargar() {
  vi.resetModules();
  return import('./ewelinkOAuth.js');
}

const jsonResp = (obj) => ({ json: async () => obj });
const firmaEsperada = (texto) => crypto.createHmac('sha256', 'secret123').update(texto).digest('base64');

beforeEach(() => setEnv(ENV_OK));
afterEach(() => vi.restoreAllMocks());

describe('urlAutorizacion', () => {
  it('arma la URL con la firma sobre "appId_seq"', async () => {
    const oauth = await cargar();
    const url = new URL(oauth.urlAutorizacion('estado-1'));

    expect(url.origin + url.pathname).toBe('https://c2ccdn.coolkit.cc/oauth/index.html');
    const p = url.searchParams;
    expect(p.get('clientId')).toBe('app123');
    expect(p.get('redirectUrl')).toBe(ENV_OK.EWELINK_REDIRECT_URL);
    expect(p.get('grantType')).toBe('authorization_code');
    expect(p.get('state')).toBe('estado-1');

    // La firma de esta URL no es sobre un cuerpo JSON sino sobre "<appId>_<seq>".
    expect(p.get('authorization')).toBe(firmaEsperada(`app123_${p.get('seq')}`));
  });

  it('escapa la firma: un "+" crudo se leería como espacio y no coincidiría', async () => {
    const oauth = await cargar();
    const cruda = oauth.urlAutorizacion('x');
    const seq = new URL(cruda).searchParams.get('seq');
    const firma = firmaEsperada(`app123_${seq}`);
    expect(cruda).toContain(`authorization=${encodeURIComponent(firma)}`);
  });

  it('no manda showQRCode: la página lo leería como verdadero', async () => {
    const oauth = await cargar();
    expect(oauth.urlAutorizacion('x')).not.toContain('showQRCode');
  });
});

describe('canjearCode', () => {
  it('firma el cuerpo, pega en la región que llegó y normaliza los tokens', async () => {
    const vence = Date.now() + 30 * 86400e3;
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResp({
        error: 0,
        data: {
          accessToken: 'at-1',
          refreshToken: 'rt-1',
          atExpiredTime: vence,
          rtExpiredTime: vence,
          user: { email: 'duena@lavanderia.com' },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const oauth = await cargar();
    const tokens = await oauth.canjearCode('code-abc', 'eu');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu-apia.coolkit.cc/v2/user/oauth/token');
    const cuerpo = { redirectUrl: ENV_OK.EWELINK_REDIRECT_URL, code: 'code-abc', grantType: 'authorization_code' };
    expect(JSON.parse(opts.body)).toEqual(cuerpo);
    expect(opts.headers.Authorization).toBe(`Sign ${firmaEsperada(JSON.stringify(cuerpo))}`);
    expect(opts.headers['Content-Type']).toBe('application/json');

    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.region).toBe('eu');
    expect(tokens.cuenta).toBe('duena@lavanderia.com');
    expect(tokens.atExpiraAt.getTime()).toBe(vence);
  });

  it('lanza con el código de eWeLink cuando rechaza el canje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResp({ error: 405, msg: 'invalid code' })));
    const oauth = await cargar();
    await expect(oauth.canjearCode('malo', 'us')).rejects.toThrow(/405/);
  });
});

describe('refrescarToken', () => {
  it('manda el rt firmado y devuelve el par nuevo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ error: 0, data: { at: 'at-2', rt: 'rt-2' } }));
    vi.stubGlobal('fetch', fetchMock);

    const oauth = await cargar();
    const tokens = await oauth.refrescarToken('rt-viejo', 'us');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us-apia.coolkit.cc/v2/user/refresh');
    expect(JSON.parse(opts.body)).toEqual({ rt: 'rt-viejo' });
    expect(opts.headers.Authorization).toBe(`Sign ${firmaEsperada(JSON.stringify({ rt: 'rt-viejo' }))}`);
    expect(tokens.accessToken).toBe('at-2');
    expect(tokens.refreshToken).toBe('rt-2');
    // Sin fechas en la respuesta se asumen los plazos que documenta eWeLink.
    expect(tokens.atExpiraAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3);
  });
});
