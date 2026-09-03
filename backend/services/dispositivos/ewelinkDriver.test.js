import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// El driver lee la config de env al importarse, así que cada prueba resetea
// módulos y define las variables antes de importar.
const ENV_OK = {
  EWELINK_APP_ID: 'app123',
  EWELINK_APP_SECRET: 'secret123',
  EWELINK_REGION: 'us',
};

function setEnv(env) {
  for (const k of Object.keys(ENV_OK)) delete process.env[k];
  Object.assign(process.env, env);
}

const DIAS = 86400e3;

// Store falso: el driver no toca la base en las pruebas. `estaConectada`
// replica la regla real (sin refresh token vigente no hay nada que renovar).
function storeFalso(cuenta) {
  return {
    fila: cuenta,
    guardados: [],
    async leerCuenta() {
      return this.fila;
    },
    estaConectada(c) {
      if (!c?.access_token || !c?.refresh_token) return false;
      return !c.rt_expira_at || new Date(c.rt_expira_at) > new Date();
    },
    async guardarTokens(tokens) {
      this.guardados.push(tokens);
      this.fila = {
        ...this.fila,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        region: tokens.region,
        at_expira_at: tokens.atExpiraAt,
        rt_expira_at: tokens.rtExpiraAt,
      };
      return this.fila;
    },
  };
}

const CUENTA_OK = {
  access_token: 'token-abc',
  refresh_token: 'rt-abc',
  region: 'us',
  at_expira_at: new Date(Date.now() + 20 * DIAS),
  rt_expira_at: new Date(Date.now() + 50 * DIAS),
};

async function cargarDriver(cuenta = CUENTA_OK) {
  vi.resetModules();
  const driver = await import('./ewelinkDriver.js');
  const store = storeFalso(cuenta ? { ...cuenta } : null);
  driver._setStore(store);
  return { driver, store };
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
    const { driver } = await cargarDriver();
    expect(await driver.encender({ device_id: 'd1' })).toEqual({ ok: false, estado: null, motivo: 'ewelink_no_configurado' });
  });
});

describe('ewelinkDriver — con configuración (fetch mockeado)', () => {
  beforeEach(() => setEnv(ENV_OK));

  it('sin cuenta autorizada no llama a la nube y pide conectarla', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver(null);
    const r = await driver.encender({ device_id: 'd1' });
    expect(r).toEqual({ ok: false, estado: null, motivo: 'sin_cuenta_conectada' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con el refresh token vencido pide volver a autorizar', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { driver } = await cargarDriver({
      ...CUENTA_OK,
      at_expira_at: new Date(Date.now() - DIAS),
      rt_expira_at: new Date(Date.now() - DIAS),
    });
    expect((await driver.encender({ device_id: 'd1' })).motivo).toBe('sesion_expirada');
  });

  it('encender usa el token guardado y manda el comando switch on', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    const r = await driver.encender({ device_id: 'd1' });
    expect(r).toEqual({ ok: true, estado: 'on' });

    // Una sola llamada: la sesión ya estaba guardada, no hay login que hacer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [cmdUrl, cmdOpts] = fetchMock.mock.calls[0];
    expect(cmdUrl).toBe('https://us-apia.coolkit.cc/v2/device/thing/status');
    expect(cmdOpts.method).toBe('POST');
    expect(cmdOpts.headers.Authorization).toBe('Bearer token-abc');
    expect(cmdOpts.headers['X-CK-Appid']).toBe('app123');
    // eWeLink rechaza con error 400 cualquier Content-Type que no sea uno de
    // sus dos valores exactos; ya nos costó una prueba en vivo (2026-09-02).
    expect(cmdOpts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(cmdOpts.body)).toEqual({ type: 1, id: 'd1', params: { switch: 'on' } });
  });

  it('renueva el token cuando está por vencer, y lo guarda', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'token-nuevo', rt: 'rt-nuevo' } })) // refresh
      .mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));                                   // comando
    vi.stubGlobal('fetch', fetchMock);

    const { driver, store } = await cargarDriver({
      ...CUENTA_OK,
      at_expira_at: new Date(Date.now() + 3600e3), // vence en una hora
    });
    expect(await driver.encender({ device_id: 'd1' })).toEqual({ ok: true, estado: 'on' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://us-apia.coolkit.cc/v2/user/refresh');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ rt: 'rt-abc' });
    // El token renovado se persiste: si solo viviera en memoria, el siguiente
    // reinicio volvería a pedir autorización.
    expect(store.guardados[0].accessToken).toBe('token-nuevo');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-nuevo');
  });

  it('si la nube rechaza el token, lo renueva y reintenta una vez', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ error: 402, msg: 'token expired' }))                    // comando rechazado
      .mockResolvedValueOnce(jsonResp({ error: 0, data: { at: 'token-2', rt: 'rt-2' } }))       // refresh
      .mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));                                  // reintento
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    expect(await driver.encender({ device_id: 'd1' })).toEqual({ ok: true, estado: 'on' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer token-2');
  });

  it('reusa el token en memoria (no relee la cuenta en cada comando)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ error: 0, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    await driver.encender({ device_id: 'd1' });
    await driver.apagar({ device_id: 'd1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('multi-relé usa switches con outlet', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({ error: 0, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    await driver.encender({ device_id: 'd1', device_canal: 2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params).toEqual({ switches: [{ switch: 'on', outlet: 2 }] });
  });

  it('estado lee y mapea el switch', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({ error: 0, data: { params: { switch: 'off' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    expect(await driver.estado({ device_id: 'd1' })).toEqual({ ok: true, estado: 'off' });
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/device/thing/status?');
  });

  it('un error de la nube se refleja como ok:false', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({ error: 40001, msg: 'device offline' }));
    vi.stubGlobal('fetch', fetchMock);

    const { driver } = await cargarDriver();
    const r = await driver.encender({ device_id: 'd1' });
    expect(r.ok).toBe(false);
    // El código que devolvió eWeLink viaja en el motivo: es la única pista que
    // llega a la pantalla cuando falla la prueba de enlace.
    expect(r.motivo).toBe('ewelink_40001');
  });
});
