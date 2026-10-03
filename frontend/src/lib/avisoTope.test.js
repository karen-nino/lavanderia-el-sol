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
  it('ignora la que no es cronómetro, la libre y la encendida a mano', () => {
    expect(clavesEnTope([
      maq({ en_uso_desde: hace(90), cronometro: false }),
      maq({ en_uso_desde: hace(90), estado: 'disponible' }),
      maq({ en_uso_desde: hace(90), encendida_manual_at: hace(90) }),
    ], ahora)).toEqual([]);
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
