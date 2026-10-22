import { describe, it, expect } from 'vitest';
import { lineasEntradas, lineasSalidas, lineasDevuelto, textoMedidasEquivalencia } from './formatoInventario';

const granel = { medidas_por_botella: 2, medidas_por_bidon: 50 };

describe('lineasEntradas (Reporte diario)', () => {
  it('sin entradas lleva guion', () => {
    expect(lineasEntradas({ ...granel }, false)).toEqual(['—']);
    expect(lineasEntradas({ medidas_por_botella: 1 }, true)).toEqual(['—']);
  });
  it('lo que se cuenta por pieza va en una línea', () => {
    expect(lineasEntradas({ medidas_por_botella: 1, entrada_botellas_medidas: 3 }, true)).toEqual(['3 piezas']);
  });
  it('granel separa botellas y bidón', () => {
    expect(lineasEntradas({ ...granel, entrada_granel_medidas: 50 }, false)).toEqual(['A granel: 1 bidón']);
    expect(lineasEntradas({ ...granel, entrada_botellas_medidas: 4, entrada_granel_medidas: 50 }, false))
      .toEqual(['Rellenadas: 2 botellas', 'A granel: 1 bidón']);
  });
});

describe('lineasSalidas (Reporte diario)', () => {
  it('suma lo que salió por notas y las salidas manuales', () => {
    expect(lineasSalidas({ ...granel, vendido_vigente_medidas: 2, salida_botellas_medidas: 2 }, false)).toEqual(['2 botellas = 4 medidas']);
  });
  it('la salida manual del bidón va aparte', () => {
    expect(lineasSalidas({ ...granel, vendido_vigente_medidas: 2, salida_granel_medidas: 50 }, false))
      .toEqual(['Rellenadas: 1 botella = 2 medidas', 'A granel: 1 bidón']);
  });
  it('lo que se devolvió no cuenta: solo lo dice Devuelto', () => {
    // Todo lo vendido se devolvió: Salidas queda sin movimiento.
    expect(lineasSalidas({ ...granel, vendido_medidas: 0, vendido_vigente_medidas: 0, devuelto_medidas: 2 }, false)).toEqual(['—']);
    expect(lineasDevuelto({ ...granel, devuelto_medidas: 2 }, false)).toEqual(['1 botella']);
  });
  it('lo devuelto tiene su propia línea', () => {
    expect(lineasDevuelto({ ...granel, devuelto_medidas: 2 }, false)).toEqual(['1 botella']);
    expect(lineasDevuelto({ ...granel }, false)).toEqual(['—']);
  });
});

describe('textoMedidasEquivalencia', () => {
  it('dice las medidas y, si llegan a una botella, su equivalencia', () => {
    expect(textoMedidasEquivalencia(1, 2)).toBe('1 medida');
    expect(textoMedidasEquivalencia(2, 2)).toBe('1 botella = 2 medidas');
    expect(textoMedidasEquivalencia(3, 2)).toBe('1 botella y 1 medida = 3 medidas');
  });
  it('sin tamaño de botella, solo medidas', () => {
    expect(textoMedidasEquivalencia(5, null)).toBe('5 medidas');
  });
});

// Lo apartado en notas ya salió: cuenta en Salidas aunque siga en el estante.
describe('lineasSalidas con apartados', () => {
  it('suma lo vendido, lo apartado y lo sacado a mano', () => {
    const marca = { medidas_por_botella: 1, vendido_vigente_medidas: 2, apartado_medidas: 1, salida_botellas_medidas: 0 };
    expect(lineasSalidas(marca, true)).toEqual(['3 piezas']);
  });
});
