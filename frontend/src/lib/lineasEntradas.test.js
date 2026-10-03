import { describe, it, expect } from 'vitest';
import { lineasEntradas, lineasSalidas, lineasDevuelto } from './formatoInventario';

const granel = { medidas_por_botella: 2, medidas_por_bidon: 50 };

describe('lineasEntradas (Reporte diario)', () => {
  it('sin entradas lleva guion', () => {
    expect(lineasEntradas({ ...granel }, false)).toEqual(['—']);
    expect(lineasEntradas({ medidas_por_botella: 1 }, true)).toEqual(['—']);
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

describe('lineasSalidas (Reporte diario)', () => {
  it('suma lo que salió por notas y las salidas manuales', () => {
    expect(lineasSalidas({ ...granel, vendido_medidas: 2, salida_botellas_medidas: 2 }, false)).toEqual(['2 botellas']);
  });
  it('la salida manual del bidón va aparte', () => {
    expect(lineasSalidas({ ...granel, vendido_medidas: 2, salida_granel_medidas: 50 }, false))
      .toEqual(['Rellenadas: 1 botella', 'A granel: 1 bidón']);
  });
  it('cuenta lo vendido completo: lo devuelto va en su columna', () => {
    // El servidor manda lo vendido neto (venta − devuelto).
    expect(lineasSalidas({ ...granel, vendido_medidas: 0, devuelto_medidas: 2 }, false)).toEqual(['1 botella']);
    expect(lineasSalidas({ ...granel, vendido_medidas: -4, devuelto_medidas: 4 }, false)).toEqual(['—']);
  });
  it('lo devuelto tiene su propia línea', () => {
    expect(lineasDevuelto({ ...granel, devuelto_medidas: 2 }, false)).toEqual(['1 botella']);
    expect(lineasDevuelto({ ...granel }, false)).toEqual(['—']);
  });
});
