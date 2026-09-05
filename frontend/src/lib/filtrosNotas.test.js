import { describe, it, expect, beforeEach } from 'vitest';
import { recordarListaNotas, urlListaNotas } from './filtrosNotas.js';

describe('filtrosNotas', () => {
  beforeEach(() => sessionStorage.clear());

  it('sin nada recordado devuelve la lista sin filtros', () => {
    expect(urlListaNotas()).toBe('/notas');
  });

  it('devuelve la última lista recordada, con sus filtros', () => {
    recordarListaNotas('/notas?fecha=AYER');
    expect(urlListaNotas()).toBe('/notas?fecha=AYER');
  });

  it('se queda con la más reciente', () => {
    recordarListaNotas('/notas?fecha=AYER');
    recordarListaNotas('/notas?estado=PENDIENTE&fecha=TODAS');
    expect(urlListaNotas()).toBe('/notas?estado=PENDIENTE&fecha=TODAS');
  });
});
