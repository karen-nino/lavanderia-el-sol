import { describe, it, expect } from 'vitest';
import { textoDuracion, tipoMaquinaTexto, totalesReporte } from './reporteMaquinas';

describe('textoDuracion', () => {
  it('escribe minutos y horas', () => {
    expect(textoDuracion(45 * 60)).toBe('45 min');
    expect(textoDuracion(65 * 60)).toBe('1 h 05 min');
    expect(textoDuracion(30)).toBe('menos de 1 min');
  });

  it('sin dato o en cero, un guion', () => {
    expect(textoDuracion(null)).toBe('—');
    expect(textoDuracion(0)).toBe('—');
  });
});

describe('tipoMaquinaTexto', () => {
  it('nombra lavadoras y secadoras con su tamaño', () => {
    expect(tipoMaquinaTexto({ tipo: 'lavadora_jumbo' })).toBe('Lavadora jumbo');
    expect(tipoMaquinaTexto({ tipo: 'secadora', tamano: 'jumbo' })).toBe('Secadora jumbo');
    expect(tipoMaquinaTexto({ tipo: 'secadora', tamano: 'mediana' })).toBe('Secadora mediana');
  });
});

describe('totalesReporte', () => {
  it('suma ciclos, tiempo, topes y lo generado', () => {
    const t = totalesReporte([
      { usos: 2, segundos: 600, topes: 1, generado: 140 },
      { usos: 1, segundos: 300, topes: 0, generado: 50 },
    ]);
    expect(t).toEqual({ usos: 3, segundos: 900, topes: 1, generado: 190 });
  });
});
