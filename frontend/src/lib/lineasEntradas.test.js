import { describe, it, expect } from 'vitest';
import { lineasEntradas } from './formatoInventario';

const granel = { medidas_por_botella: 2, medidas_por_bidon: 50 };

describe('lineasEntradas (Reporte diario)', () => {
  it('sin entradas dice 0', () => {
    expect(lineasEntradas({ ...granel }, false)).toEqual(['0 botellas']);
  });
  it('lo que se cuenta por unidad va en una línea', () => {
    expect(lineasEntradas({ medidas_por_botella: 1, entrada_botellas_medidas: 3 }, true)).toEqual(['3 unidades']);
  });
  it('granel separa botellas y bidón', () => {
    expect(lineasEntradas({ ...granel, entrada_granel_medidas: 50 }, false)).toEqual(['A granel: 1 bidón']);
    expect(lineasEntradas({ ...granel, entrada_botellas_medidas: 4, entrada_granel_medidas: 50 }, false))
      .toEqual(['Rellenadas: 2 botellas', 'A granel: 1 bidón']);
  });
});
