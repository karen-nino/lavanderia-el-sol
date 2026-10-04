import { describe, it, expect } from 'vitest';
import { capitalizarNombre, mismoNombre } from './texto.js';

describe('capitalizarNombre', () => {
  it('capitaliza cada palabra y baja el resto', () => {
    expect(capitalizarNombre('juan PEREZ')).toBe('Juan Perez');
  });

  it('colapsa espacios y recorta', () => {
    expect(capitalizarNombre('  ana   maria ')).toBe('Ana Maria');
  });

  it('null/undefined/vacío → cadena vacía', () => {
    expect(capitalizarNombre(null)).toBe('');
    expect(capitalizarNombre(undefined)).toBe('');
    expect(capitalizarNombre('   ')).toBe('');
  });
});

describe('mismoNombre', () => {
  it('ignora mayúsculas, acentos y espacios de más', () => {
    expect(mismoNombre('  rebeca ', 'Rebeca')).toBe(true);
    expect(mismoNombre('jose  lopez', 'José López')).toBe(true);
  });
  it('un nombre a medias o solo el nombre de pila no es el mismo', () => {
    expect(mismoNombre('rebe', 'Rebeca')).toBe(false);
    expect(mismoNombre('ana', 'Ana López')).toBe(false);
  });
  it('vacío nunca coincide', () => {
    expect(mismoNombre('', '')).toBe(false);
  });
});
