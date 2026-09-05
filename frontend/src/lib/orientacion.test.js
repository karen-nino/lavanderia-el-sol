import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./pwa', () => ({ estaInstalada: vi.fn() }));

import { estaInstalada } from './pwa';
import { esTelefono, ajustarOrientacion } from './orientacion';

// User agents reales, para que la prueba valga de algo.
const UA = {
  androidTelefono: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  // Las tablets Android omiten el token "Mobile": es la única marca fiable.
  androidTablet:   'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  iphone:          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad:            'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  escritorio:      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('esTelefono', () => {
  it('cree a userAgentData cuando existe, sin mirar el UA', () => {
    // Es la señal buena de Chromium: mobile es true solo en teléfonos.
    expect(esTelefono({ userAgentData: { mobile: true },  userAgent: UA.escritorio })).toBe(true);
    expect(esTelefono({ userAgentData: { mobile: false }, userAgent: UA.androidTelefono })).toBe(false);
  });

  it('distingue teléfono de tablet en Android por el token "Mobile"', () => {
    expect(esTelefono({ userAgent: UA.androidTelefono })).toBe(true);
    expect(esTelefono({ userAgent: UA.androidTablet })).toBe(false);
  });

  it('iPhone sí, iPad no', () => {
    expect(esTelefono({ userAgent: UA.iphone })).toBe(true);
    expect(esTelefono({ userAgent: UA.ipad })).toBe(false);
  });

  it('el escritorio nunca cuenta como teléfono', () => {
    expect(esTelefono({ userAgent: UA.escritorio })).toBe(false);
  });
});

describe('ajustarOrientacion', () => {
  let lock;

  beforeEach(() => {
    vi.clearAllMocks();
    lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('screen', { orientation: { lock } });
    vi.stubGlobal('navigator', { userAgent: UA.androidTelefono });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('en el navegador no toca la orientación', async () => {
    estaInstalada.mockReturnValue(false);
    expect(await ajustarOrientacion()).toBe('no-instalada');
    expect(lock).not.toHaveBeenCalled();
  });

  it('teléfono instalado: bloquea en vertical', async () => {
    estaInstalada.mockReturnValue(true);
    expect(await ajustarOrientacion()).toBe('bloqueada');
    expect(lock).toHaveBeenCalledWith('portrait');
  });

  it('tablet instalada: la deja rotar', async () => {
    estaInstalada.mockReturnValue(true);
    vi.stubGlobal('navigator', { userAgent: UA.androidTablet });
    expect(await ajustarOrientacion()).toBe('tablet');
    expect(lock).not.toHaveBeenCalled();
  });

  it('si el navegador no lo permite, se queda libre sin romper nada', async () => {
    // Safari rechaza el bloqueo. La app debe seguir arrancando igual.
    estaInstalada.mockReturnValue(true);
    lock.mockRejectedValue(new Error('NotSupportedError'));
    expect(await ajustarOrientacion()).toBe('no-permitida');
  });

  it('si el navegador no tiene la API, tampoco falla', async () => {
    estaInstalada.mockReturnValue(true);
    vi.stubGlobal('screen', {});
    expect(await ajustarOrientacion()).toBe('no-soportado');
  });
});
