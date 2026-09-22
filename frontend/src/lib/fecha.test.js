import { describe, it, expect } from 'vitest';
import { formatHora12, formatFechaHora12, tiempoRelativo } from './fecha';

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

describe('tiempoRelativo', () => {
  const ahora = new Date('2026-08-19T12:00:00').getTime();
  const hace = ms => new Date(ahora - ms);

  it('usa "hace un momento" los primeros segundos', () => {
    expect(tiempoRelativo(hace(0), ahora)).toBe('hace un momento');
    expect(tiempoRelativo(hace(9000), ahora)).toBe('hace un momento');
  });

  it('cuenta segundos, minutos y horas', () => {
    expect(tiempoRelativo(hace(10000), ahora)).toBe('hace 10 s');
    expect(tiempoRelativo(hace(59000), ahora)).toBe('hace 59 s');
    expect(tiempoRelativo(hace(60000), ahora)).toBe('hace 1 min');
    expect(tiempoRelativo(hace(59 * 60000), ahora)).toBe('hace 59 min');
    expect(tiempoRelativo(hace(60 * 60000), ahora)).toBe('hace 1 h');
    expect(tiempoRelativo(hace(23 * 60 * 60000), ahora)).toBe('hace 23 h');
  });

  it('pasado un dia cae a la fecha completa', () => {
    expect(tiempoRelativo(hace(25 * 60 * 60000), ahora)).toMatch(/2026, \d{2}:\d{2} (am|pm)$/);
  });

  it('trata un reloj adelantado como "hace un momento"', () => {
    expect(tiempoRelativo(new Date(ahora + 5000), ahora)).toBe('hace un momento');
  });

  it('devuelve cadena vacia para nulos o invalidos', () => {
    expect(tiempoRelativo(null, ahora)).toBe('');
    expect(tiempoRelativo('', ahora)).toBe('');
    expect(tiempoRelativo('no-es-fecha', ahora)).toBe('');
  });
});
