import { describe, it, expect } from 'vitest';
import { fmtEncendida, fmtEncendidaConTope } from './tiempoEncendida';

describe('fmtEncendida', () => {
  it('sin tiempo sellado no dice nada', () => {
    expect(fmtEncendida(null)).toBeNull();
    expect(fmtEncendidaConTope(undefined, true)).toBeNull();
  });
  it('menos de un minuto es -1 min', () => {
    expect(fmtEncendida(0)).toBe('-1 min');
    expect(fmtEncendida(59)).toBe('-1 min');
  });
  it('minutos y horas', () => {
    expect(fmtEncendida(60)).toBe('1 min');
    expect(fmtEncendida(47 * 60)).toBe('47 min');
    expect(fmtEncendida(65 * 60)).toBe('1 h 05 min');
  });
  it('el tope se dice', () => {
    expect(fmtEncendidaConTope(60, true)).toBe('Tope de tiempo · 1 min');
    expect(fmtEncendidaConTope(120, false)).toBe('2 min');
  });
});
