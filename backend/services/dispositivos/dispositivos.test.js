import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as dispositivos from './index.js';
import * as nullDriver from './nullDriver.js';

// El index selecciona el driver por DISPOSITIVOS_DRIVER en tiempo de import.
// En pruebas no está definido, así que usa nullDriver (simulación en memoria).

beforeEach(() => {
  nullDriver._reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('capa driver de dispositivos (index)', () => {
  it('usa el nullDriver por defecto', () => {
    expect(dispositivos.nombreDriver()).toBe('null');
  });

  it('tieneDispositivo detecta si hay Sonoff enlazado', () => {
    expect(dispositivos.tieneDispositivo({ device_id: 'abc' })).toBe(true);
    expect(dispositivos.tieneDispositivo({ device_id: null })).toBe(false);
    expect(dispositivos.tieneDispositivo({})).toBe(false);
    expect(dispositivos.tieneDispositivo(null)).toBe(false);
  });

  it('máquina sin device_id no llama al driver y responde sin_enlazar', async () => {
    const spy = vi.spyOn(nullDriver, 'encender');
    const r = await dispositivos.encender({ device_id: null });
    expect(r).toEqual({ ok: false, estado: null, motivo: 'sin_enlazar' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('encender delega en el driver cuando hay device_id', async () => {
    const r = await dispositivos.encender({ device_id: 'dev1' });
    expect(r).toEqual({ ok: true, estado: 'on' });
  });
});

describe('nullDriver (simulación en memoria)', () => {
  const maq = { device_id: 'dev-sim' };

  it('encender deja el estado en on y estado lo refleja', async () => {
    await nullDriver.encender(maq);
    expect(await nullDriver.estado(maq)).toEqual({ ok: true, estado: 'on' });
  });

  it('apagar deja el estado en off', async () => {
    await nullDriver.encender(maq);
    await nullDriver.apagar(maq);
    expect(await nullDriver.estado(maq)).toEqual({ ok: true, estado: 'off' });
  });

  it('un device desconocido arranca en off', async () => {
    expect(await nullDriver.estado({ device_id: 'nunca-usado' })).toEqual({ ok: true, estado: 'off' });
  });
});

// DISPOSITIVOS_SUCURSALES (2026-10-09): con el driver real, solo las
// sucursales de la lista hablan con los Sonoff; las demás siguen simuladas.
describe('driver real limitado por sucursal', () => {
  const cargar = async (sucursales) => {
    vi.resetModules();
    vi.stubEnv('DISPOSITIVOS_DRIVER', 'ewelink');
    vi.stubEnv('DISPOSITIVOS_SUCURSALES', sucursales);
    const mod = await import('./index.js');
    const ewe = await import('./ewelinkDriver.js');
    const nul = await import('./nullDriver.js');
    return { mod, ewe, nul };
  };

  it('la sucursal de la lista usa eWeLink y la otra el nullDriver', async () => {
    const { mod, ewe, nul } = await cargar('zapopan');
    const real = vi.spyOn(ewe, 'encender').mockResolvedValue({ ok: true, estado: 'on' });
    const sim  = vi.spyOn(nul, 'encender');

    await mod.encender({ device_id: 'z1', sucursal: 'zapopan' });
    await mod.encender({ device_id: 'r1', sucursal: 'retiro' });

    expect(real).toHaveBeenCalledTimes(1);
    expect(real.mock.calls[0][0].device_id).toBe('z1');
    expect(sim).toHaveBeenCalledTimes(1);
    expect(sim.mock.calls[0][0].device_id).toBe('r1');
    expect(mod.esSimulacion({ sucursal: 'zapopan' })).toBe(false);
    expect(mod.esSimulacion({ sucursal: 'retiro' })).toBe(true);
    expect(mod.nombreDriver({ sucursal: 'retiro' })).toBe('null');
    vi.unstubAllEnvs();
  });

  it('sin lista, todas las sucursales usan el driver real', async () => {
    const { mod } = await cargar('');
    expect(mod.esSimulacion({ sucursal: 'retiro' })).toBe(false);
    expect(mod.esSimulacion({ sucursal: 'zapopan' })).toBe(false);
    vi.unstubAllEnvs();
  });
});
