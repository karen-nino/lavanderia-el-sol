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
  // La unidad de venta la manda el servicio: Por Encargo cobra por MEDIDA
  // (precio_unitario) y Autoservicio vende la BOTELLA entera (precio_botella).
  const producto = { precio_unitario: 15, precio_botella: 120 };

  it('Por Encargo cobra el precio por medida (cuenta contra el tope)', () => {
    expect(precioProductoEnNota(producto, 'POR_ENCARGO')).toBe(15);
  });

  it('Autoservicio cobra el precio por botella', () => {
    expect(precioProductoEnNota(producto, 'AUTOSERVICIO')).toBe(120);
  });

  // La venta de mostrador despacha piezas completas, como Autoservicio.
  it('la venta de Productos cobra el precio por botella', () => {
    expect(precioProductoEnNota(producto, 'PRODUCTOS')).toBe(120);
  });

  // Los de marca se venden por unidad (el envase) también en Por Encargo.
  it('un producto de marca cobra su precio por unidad en cualquier servicio', () => {
    const marca = { tipo_liquido: 'marca', precio_unitario: 15, precio_botella: 120 };
    expect(precioProductoEnNota(marca, 'POR_ENCARGO')).toBe(120);
    expect(precioProductoEnNota(marca, 'AUTOSERVICIO')).toBe(120);
  });

  it('sin precio en la unidad que toca devuelve 0', () => {
    // Granel sin precio por medida: en Por Encargo no hay nada que cobrar.
    expect(precioProductoEnNota({ tipo_liquido: 'granel', precio_botella: 120 }, 'POR_ENCARGO')).toBe(0);
    expect(precioProductoEnNota({ precio_unitario: 15 }, 'AUTOSERVICIO')).toBe(0);
    expect(precioProductoEnNota({}, 'AUTOSERVICIO')).toBe(0);
  });
});

describe('generarFolio', () => {
  it('consecutivo a 4 dígitos, sin fecha', () => {
    expect(generarFolio(42)).toBe('0042');
  });

  it('ids de 4+ dígitos no se truncan', () => {
    expect(generarFolio(12345)).toBe('12345');
  });
});
