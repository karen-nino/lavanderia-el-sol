import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registrarLlamada, diaLocal, _reset, _pendientes, LIMITE_MENSUAL } from './ewelinkLlamadas.js';

beforeEach(() => _reset());

describe('contador de llamadas a eWeLink', () => {
  it('cuenta por día y sucursal; sin sucursal va a la cuenta', () => {
    registrarLlamada('retiro');
    registrarLlamada('Retiro');
    registrarLlamada('zapopan');
    registrarLlamada(undefined);
    const hoy = diaLocal();
    const p = _pendientes();
    expect(p.get(`${hoy}|retiro`)).toBe(2);
    expect(p.get(`${hoy}|zapopan`)).toBe(1);
    expect(p.get(`${hoy}|`)).toBe(1);
  });

  it('el día es el de México, no el de UTC', () => {
    // 2026-11-01 03:00 UTC = 31 de octubre, 9 pm en México.
    expect(diaLocal(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-31');
  });

  it('el límite del plan gratuito es 50,000', () => {
    expect(LIMITE_MENSUAL).toBe(50000);
  });
});

describe('apiFetch cuenta cada petición a nombre de la sucursal', () => {
  it('suma una llamada al responder', async () => {
    const { apiFetch } = await import('./ewelinkOAuth.js');
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ error: 0 }) })));
    await apiFetch('https://x', '/v2/device/thing', { method: 'POST', bodyStr: '{}', sucursal: 'retiro' });
    expect(_pendientes().get(`${diaLocal()}|retiro`)).toBe(1);
    vi.unstubAllGlobals();
  });
});
