import { describe, it, expect } from 'vitest';
import { clavesEnTope, hayTopeNuevo } from './avisoTope';

const ahora = new Date('2026-10-03T20:00:00Z').getTime();
const hace = (min) => new Date(ahora - min * 60_000).toISOString();
const maq = (extra) => ({ id: 1, cronometro: true, estado: 'en_uso', ciclo_minutos: 60, ...extra });

describe('clavesEnTope', () => {
  it('cuenta la máquina que ya pasó su tope', () => {
    const m = maq({ en_uso_desde: hace(61) });
    expect(clavesEnTope([m], ahora)).toEqual([`1:${m.en_uso_desde}`]);
  });
  it('no cuenta la que aún no llega', () => {
    expect(clavesEnTope([maq({ en_uso_desde: hace(30) })], ahora)).toEqual([]);
  });
  it('ignora la libre y la encendida a mano sin nota', () => {
    expect(clavesEnTope([
      maq({ en_uso_desde: hace(90), estado: 'disponible' }),
      maq({ en_uso_desde: hace(90), encendida_manual_at: hace(90) }),
    ], ahora)).toEqual([]);
  });
  it('temporizador: cuenta el ciclo terminado solo si una nota usa la máquina', () => {
    const conNota = maq({ cronometro: false, ciclo_minutos: 45, en_uso_desde: hace(46), en_uso_nota_id: 7 });
    expect(clavesEnTope([conNota], ahora)).toEqual([`1:${conNota.en_uso_desde}`]);
    expect(clavesEnTope([maq({ cronometro: false, ciclo_minutos: 45, en_uso_desde: hace(46) })], ahora)).toEqual([]);
    expect(clavesEnTope([maq({ cronometro: false, ciclo_minutos: 45, en_uso_desde: hace(20), en_uso_nota_id: 7 })], ahora)).toEqual([]);
  });
  it('cronómetro con programa elegido: suena al cumplir el programa y otra vez en el tope', () => {
    const m = maq({ cronometro: true, ciclo_minutos: 45, ciclo_elegido_minutos: 30, en_uso_desde: hace(31) });
    expect(clavesEnTope([m], ahora)).toEqual([`1:${m.en_uso_desde}:programa`]);
    const enTope = maq({ cronometro: true, ciclo_minutos: 45, ciclo_elegido_minutos: 30, en_uso_desde: hace(46) });
    expect(clavesEnTope([enTope], ahora)).toEqual([`1:${enTope.en_uso_desde}`, `1:${enTope.en_uso_desde}:programa`]);
  });
});

describe('hayTopeNuevo', () => {
  it('al abrir la app no suena por lo que ya estaba en tope', () => {
    expect(hayTopeNuevo(null, ['1:a'])).toBe(false);
  });
  it('suena cuando llega una nueva y no repite la misma', () => {
    expect(hayTopeNuevo(new Set(), ['1:a'])).toBe(true);
    expect(hayTopeNuevo(new Set(['1:a']), ['1:a'])).toBe(false);
  });
  it('la misma máquina en otro encendido vuelve a sonar', () => {
    expect(hayTopeNuevo(new Set(['1:a']), ['1:b'])).toBe(true);
  });
});
