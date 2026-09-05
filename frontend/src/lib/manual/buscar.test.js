import { describe, it, expect } from 'vitest';
import { buscarEnManual, contarArticulos, normalizar } from './buscar.js';

const SECCIONES = [
  {
    id: 'notas', titulo: 'Notas',
    articulos: [
      { id: 'crear', titulo: 'Crear una nota de autoservicio',
        cuerpo: 'Elige el tipo de lavadora y registra el pago.', claves: ['nueva'] },
      { id: 'liquidar', titulo: 'Liquidar una nota',
        cuerpo: 'Elige la forma de pago: efectivo, transferencia o tarjeta.',
        claves: ['cobrar', 'pagar'] },
    ],
  },
  {
    id: 'caja', titulo: 'Caja',
    articulos: [
      { id: 'corte', titulo: 'Hacer el corte del día',
        cuerpo: 'Cuenta el efectivo del cajón y cierra la caja.', claves: [] },
    ],
  },
];

describe('buscarEnManual', () => {
  it('sin consulta devuelve el manual entero', () => {
    expect(contarArticulos(buscarEnManual(SECCIONES, ''))).toBe(3);
    expect(contarArticulos(buscarEnManual(SECCIONES, '   '))).toBe(3);
  });

  it('encuentra por el cuerpo, no solo por el título', () => {
    const r = buscarEnManual(SECCIONES, 'cajón');
    expect(contarArticulos(r)).toBe(1);
    expect(r[0].articulos[0].id).toBe('corte');
  });

  // Nadie escribe los acentos al buscar con prisa.
  it('ignora acentos y mayúsculas', () => {
    expect(contarArticulos(buscarEnManual(SECCIONES, 'CAJON'))).toBe(1);
    expect(contarArticulos(buscarEnManual(SECCIONES, 'dia'))).toBe(1);
  });

  // El artículo dice "liquidar"; la gente busca "cobrar".
  it('encuentra por las palabras con que la gente lo buscaría', () => {
    const r = buscarEnManual(SECCIONES, 'cobrar');
    expect(r[0].articulos[0].id).toBe('liquidar');
  });

  it('exige TODAS las palabras, no cualquiera', () => {
    expect(contarArticulos(buscarEnManual(SECCIONES, 'nota tarjeta'))).toBe(1);
    expect(contarArticulos(buscarEnManual(SECCIONES, 'nota bicicleta'))).toBe(0);
  });

  it('no devuelve secciones vacías, para no dejar encabezados huérfanos', () => {
    const r = buscarEnManual(SECCIONES, 'lavadora');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('notas');
  });

  it('pone primero lo que coincide en el título', () => {
    // "nota" está en los dos títulos de la sección y en el cuerpo de ninguno.
    const r = buscarEnManual(SECCIONES, 'una nota');
    expect(r[0].articulos.map(a => a.id)).toEqual(['crear', 'liquidar']);
  });

  it('sin resultados devuelve una lista vacía', () => {
    expect(buscarEnManual(SECCIONES, 'helicóptero')).toEqual([]);
  });
});

describe('normalizar', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalizar('Jabón EN Polvo')).toBe('jabon en polvo');
  });
  it('null/undefined no truenan', () => {
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});
