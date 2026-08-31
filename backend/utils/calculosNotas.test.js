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
  // La unidad de venta la manda el servicio: Por Encargo cobra por TAPA
  // (precio_unitario) y Autoservicio vende la BOTELLA entera (precio_botella).
  const producto = { precio_unitario: 15, precio_botella: 120 };

  it('Por Encargo cobra el precio por tapa (cuenta contra el tope)', () => {
    expect(precioProductoEnNota(producto, 'POR_ENCARGO')).toBe(15);
  });

  it('Autoservicio cobra el precio por botella', () => {
    expect(precioProductoEnNota(producto, 'AUTOSERVICIO')).toBe(120);
  });

  it('sin precio en la unidad que toca devuelve 0', () => {
    // Producto de marca que solo se vende por botella: por tapa no tiene precio.
    expect(precioProductoEnNota({ precio_botella: 120 }, 'POR_ENCARGO')).toBe(0);
    expect(precioProductoEnNota({ precio_unitario: 15 }, 'AUTOSERVICIO')).toBe(0);
    expect(precioProductoEnNota({}, 'AUTOSERVICIO')).toBe(0);
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
