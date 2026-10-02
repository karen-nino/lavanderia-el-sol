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

  // La venta de mostrador (mig. 112) despacha piezas completas, como
  // Autoservicio: si cayera del lado de la medida se cobraría una fracción.
  it('la venta de Productos cobra el precio por botella', () => {
    expect(precioProductoEnNota(producto, 'PRODUCTOS')).toBe(120);
  });

  // Los de marca se venden por unidad (el envase completo) también en Por
  // Encargo: no se sirven por medidas como el granel (2026-09-25).
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
  it('formatea SEQ-DDMMYY con padding a 4 del id', () => {
    // Fecha local: 9 de julio de 2026.
    const fecha = new Date(2026, 6, 9, 12, 0, 0);
    expect(generarFolio(42, fecha)).toBe('0042-090726');
  });

  // Regresión: el día del folio es el del negocio (America/Mexico_City), no el
  // del servidor. En producción Node corre en UTC, así que una nota de las
  // 19:30 locales se sellaba con la fecha del día siguiente.
  it('usa el día del negocio aunque el servidor corra en UTC', () => {
    // 2 de septiembre, 19:30 en México = 3 de septiembre, 01:30 UTC.
    const fecha = new Date('2026-09-03T01:30:00Z');
    expect(generarFolio(42, fecha)).toBe('0042-020926');
  });

  it('ids de 4+ dígitos no se truncan', () => {
    const fecha = new Date(2026, 0, 1, 12, 0, 0);
    expect(generarFolio(12345, fecha)).toBe('12345-010126');
  });
});
