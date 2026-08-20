import { describe, it, expect } from 'vitest';
import {
  tarifaSecadora,
  precioProductoEnNota,
  generarFolio,
} from './calculosNotas.js';

describe('tarifaSecadora', () => {
  const t = { secadora: 20, secadoraJumbo: 35, secadoraEdredon: 50 };

  it('la secadora es de un solo tamaño: precio único, ignora tamaño y prenda', () => {
    expect(tarifaSecadora('mediana', 'ROPA', t)).toBe(20);
    expect(tarifaSecadora('jumbo', 'ROPA', t)).toBe(20);
    expect(tarifaSecadora('jumbo', 'EDREDON', t)).toBe(20);
    expect(tarifaSecadora(null, undefined, t)).toBe(20);
  });
});

describe('precioProductoEnNota', () => {
  const porTapa = { es_por_tapa: true, precio_unitario: 15 };
  const normal  = { es_por_tapa: false, precio_unitario: 40 };

  it('producto por tapa se cobra su precio en Por Encargo (cuenta contra el tope)', () => {
    expect(precioProductoEnNota(porTapa, 'POR_ENCARGO')).toBe(15);
  });

  it('producto por tapa se cobra en Autoservicio', () => {
    expect(precioProductoEnNota(porTapa, 'AUTOSERVICIO')).toBe(15);
  });

  it('producto normal cobra su precio en cualquier tipo de servicio', () => {
    expect(precioProductoEnNota(normal, 'POR_ENCARGO')).toBe(40);
    expect(precioProductoEnNota(normal, 'AUTOSERVICIO')).toBe(40);
  });

  it('sin precio_unitario devuelve 0', () => {
    expect(precioProductoEnNota({ es_por_tapa: false }, 'AUTOSERVICIO')).toBe(0);
  });
});

describe('generarFolio', () => {
  it('formatea SEQ-DDMMYY con padding a 4 del id', () => {
    // Fecha local: 9 de julio de 2026.
    const fecha = new Date(2026, 6, 9, 12, 0, 0);
    expect(generarFolio(42, fecha)).toBe('0042-090726');
  });

  it('ids de 4+ dígitos no se truncan', () => {
    const fecha = new Date(2026, 0, 1, 12, 0, 0);
    expect(generarFolio(12345, fecha)).toBe('12345-010126');
  });
});
