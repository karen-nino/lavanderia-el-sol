import { describe, it, expect } from 'vitest';
import { rangoDePeriodo, etiquetaPeriodo } from './periodo';

describe('rangoDePeriodo', () => {
  it('mes y año: del primer día al primero del siguiente', () => {
    const mes = rangoDePeriodo({ periodo: 'mes', anio: 2026, mes: 10 });
    expect([mes.desde, mes.hasta]).toEqual([new Date(2026, 10, 1), new Date(2026, 11, 1)]);
    const anio = rangoDePeriodo({ periodo: 'anio', anio: 2026 });
    expect([anio.desde, anio.hasta]).toEqual([new Date(2026, 0, 1), new Date(2027, 0, 1)]);
  });

  it('personalizado incluye el día Hasta; sin fechas completas no hay rango', () => {
    const r = rangoDePeriodo({ periodo: 'custom', desde: '2026-11-01', hasta: '2026-11-10' });
    expect([r.desde, r.hasta]).toEqual([new Date(2026, 10, 1), new Date(2026, 10, 11)]);
    expect(rangoDePeriodo({ periodo: 'custom', desde: '2026-11-01', hasta: '' })).toBeNull();
  });

  it('hoy dura un día', () => {
    const r = rangoDePeriodo({ periodo: 'hoy' });
    expect(r.hasta - r.desde).toBeGreaterThanOrEqual(23 * 3600000);
  });
});

describe('etiquetaPeriodo', () => {
  it('nombra el período elegido', () => {
    expect(etiquetaPeriodo({ periodo: 'mes', anio: 2026, mes: 10 })).toBe('Noviembre 2026');
    expect(etiquetaPeriodo({ periodo: 'custom', desde: '2026-11-01', hasta: '2026-11-10' })).toBe('1 - 10 de Noviembre 2026');
  });
});
