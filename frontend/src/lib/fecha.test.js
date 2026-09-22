import { describe, it, expect } from 'vitest';
import { formatHora12, formatFechaHora12 } from './fecha';

describe('formatHora12', () => {
  it('formatea en 12h con cero inicial y am/pm en minúsculas', () => {
    expect(formatHora12(new Date('2026-08-19T09:05:00'))).toBe('09:05 am');
    expect(formatHora12(new Date('2026-08-19T14:30:00'))).toBe('02:30 pm');
    expect(formatHora12(new Date('2026-08-19T00:00:00'))).toBe('12:00 am');
    expect(formatHora12(new Date('2026-08-19T23:59:00'))).toBe('11:59 pm');
  });

  it('acepta string ISO', () => {
    expect(formatHora12('2026-08-19T13:07:00')).toBe('01:07 pm');
  });

  it('devuelve cadena vacía para valores inválidos o nulos', () => {
    expect(formatHora12(null)).toBe('');
    expect(formatHora12('')).toBe('');
    expect(formatHora12('no-es-fecha')).toBe('');
  });
});

describe('formatFechaHora12', () => {
  it('combina fecha corta y hora 12h', () => {
    expect(formatFechaHora12(new Date('2026-08-19T09:05:00'))).toMatch(/^\d{2} \w+ 2026, 09:05 am$/);
  });

  it('devuelve cadena vacía para nulos', () => {
    expect(formatFechaHora12(null)).toBe('');
  });
});
