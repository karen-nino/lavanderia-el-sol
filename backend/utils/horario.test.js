import { describe, it, expect } from 'vitest';
import { abiertaConMargen } from './horario.js';

// Lunes a sábado de 9 a 19 h, domingo cerrado.
const semana = Array.from({ length: 7 }, (_, dia) => (
  dia === 6
    ? { dia, abierto: false, abre: null, cierra: null }
    : { dia, abierto: true, abre: '09:00', cierra: '19:00' }
));

// Hora de la Ciudad de México (UTC-6): el 2026-11-03 es martes.
const mx = (fechaHora) => new Date(`${fechaHora}:00-06:00`);

describe('abiertaConMargen', () => {
  it('abierta en horario', () => {
    expect(abiertaConMargen(semana, mx('2026-11-03T09:00'), 60)).toBe(true);
    expect(abiertaConMargen(semana, mx('2026-11-03T14:30'), 60)).toBe(true);
  });

  it('cuenta la hora de margen después de cerrar', () => {
    expect(abiertaConMargen(semana, mx('2026-11-03T20:00'), 60)).toBe(true);
    expect(abiertaConMargen(semana, mx('2026-11-03T20:01'), 60)).toBe(false);
  });

  it('cerrada de noche y antes de abrir', () => {
    expect(abiertaConMargen(semana, mx('2026-11-03T23:00'), 60)).toBe(false);
    expect(abiertaConMargen(semana, mx('2026-11-04T08:59'), 60)).toBe(false);
  });

  it('el día cerrado no cuenta', () => {
    expect(abiertaConMargen(semana, mx('2026-11-08T12:00'), 60)).toBe(false);
  });

  it('el margen de ayer cruza la medianoche', () => {
    const tarde = semana.map((d) => (d.abierto ? { ...d, cierra: '23:30' } : d));
    expect(abiertaConMargen(tarde, mx('2026-11-04T00:15'), 60)).toBe(true);
    expect(abiertaConMargen(tarde, mx('2026-11-04T00:31'), 60)).toBe(false);
  });

  it('sin horario capturado siempre cuenta como abierta', () => {
    expect(abiertaConMargen(null, mx('2026-11-03T03:00'), 60)).toBe(true);
  });
});
