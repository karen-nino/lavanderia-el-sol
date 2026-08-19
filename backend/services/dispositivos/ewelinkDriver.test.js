import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// El driver lee la config de env al importarse, así que cada prueba resetea
// módulos y define las variables antes de importar.
const ENV_OK = {
  EWELINK_APP_ID: 'app123',
  EWELINK_APP_SECRET: 'secret123',
  EWELINK_EMAIL: 'dueno@lavanderia.com',
  EWELINK_PASSWORD: 'pass123',
  EWELINK_COUNTRY_CODE: '+52',
  EWELINK_REGION: 'us',
};

function setEnv(env) {
  for (const k of Object.keys(ENV_OK)) delete process.env[k];
  Object.assign(process.env, env);
}

async function cargarDriver() {
  vi.resetModules();
  return import('./ewelinkDriver.js');
}

const jsonResp = (obj) => ({ json: async () => obj });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ewelinkDriver — sin configuración', () => {
  it('devuelve ewelink_no_configurado si faltan credenciales', async () => {
    setEnv({});
    const driver = await cargarDriver();
    expect(await driver.encender({ device_id: 'd1' })).toEqual({ ok: false, estado: null, motivo: 'ewelink_no_configurado' });
  });
});

describe('ewelinkDriver — con configuración (fetch mockeado)', () => {
  beforeEach(() => setEnv(ENV_OK));

  it('encender inicia sesión y manda el comando switch on', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'token-abc' } })) // login
      .mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));                  // set switch
    vi.stubGlobal('fetch', fetchMock);

    const driver = await cargarDriver();
    const r = await driver.encender({ device_id: 'd1' });
    expect(r).toEqual({ ok: true, estado: 'on' });

    // Login firmado.
    const [loginUrl, loginOpts] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe('https://us-apia.coolkit.cc/v2/user/login');
    expect(loginOpts.headers['X-CK-Appid']).toBe('app123');
    expect(loginOpts.headers.Authorization).toMatch(/^Sign /);

    // Comando con Bearer y body correcto.
    const [cmdUrl, cmdOpts] = fetchMock.mock.calls[1];
    expect(cmdUrl).toBe('https://us-apia.coolkit.cc/v2/device/thing/status');
    expect(cmdOpts.method).toBe('POST');
    expect(cmdOpts.headers.Authorization).toBe('Bearer token-abc');
    expect(JSON.parse(cmdOpts.body)).toEqual({ type: 1, id: 'd1', params: { switch: 'on' } });
  });

  it('reusa el token en la segunda llamada (no vuelve a hacer login)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'tok' } }))
      .mockResolvedValue(jsonResp({ error: 0, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = await cargarDriver();
    await driver.encender({ device_id: 'd1' });
    await driver.apagar({ device_id: 'd1' });
    // 1 login + 2 comandos = 3 llamadas.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('multi-relé usa switches con outlet', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'tok' } }))
      .mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = await cargarDriver();
    await driver.encender({ device_id: 'd1', device_canal: 2 });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.params).toEqual({ switches: [{ switch: 'on', outlet: 2 }] });
  });

  it('estado lee y mapea el switch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'tok' } }))
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { params: { switch: 'off' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = await cargarDriver();
    expect(await driver.estado({ device_id: 'd1' })).toEqual({ ok: true, estado: 'off' });
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/device/thing/status?');
  });

  it('un error de la nube se refleja como ok:false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'tok' } }))
      .mockResolvedValueOnce(jsonResp({ error: 40001, msg: 'device offline' }));
    vi.stubGlobal('fetch', fetchMock);

    const driver = await cargarDriver();
    const r = await driver.encender({ device_id: 'd1' });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('error_red');
  });
});
