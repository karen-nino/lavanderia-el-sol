import { describe, it, expect } from 'vitest';
import { precioDePrograma, cobraPorPrograma, etiquetaPrograma } from './tiemposModelo';

const sec49 = (precios) => ({ modelo_tiempos: { pregunta: true, minutos: [1, 2, 3], precios } });

describe('precio por programa (Sec49)', () => {
  it('cada programa con su precio', () => {
    const m = sec49([20, 40, 50]);
    expect(precioDePrograma(m, 2)).toBe(40);
    expect(cobraPorPrograma(m)).toBe(true);
  });

  it('sin precios no cobra por programa', () => {
    expect(cobraPorPrograma(sec49([null, null, null]))).toBe(false);
    expect(cobraPorPrograma({ modelo_tiempos: { pregunta: true, minutos: [1, 2, 3] } })).toBe(false);
  });

  it('el botón dice "1 min · $20" solo en Autoservicio', () => {
    const m = sec49([20, 40.5, null]);
    expect(etiquetaPrograma(m, true)(1)).toBe('1 min · $20');
    expect(etiquetaPrograma(m, true)(2)).toBe('2 min · $40.50');
    expect(etiquetaPrograma(m, true)(3)).toBe('3 min');
    expect(etiquetaPrograma(m, false)(1)).toBe('1 min');
  });
});
