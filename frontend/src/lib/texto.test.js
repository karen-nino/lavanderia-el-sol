import { describe, it, expect } from 'vitest';
import { capitalizarNombre } from './texto.js';

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
