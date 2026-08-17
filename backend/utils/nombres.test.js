import { describe, it, expect } from 'vitest';
import { capitalizarNombre } from './nombres.js';

describe('capitalizarNombre', () => {
  it('capitaliza cada palabra', () => {
    expect(capitalizarNombre('juan humberto')).toBe('Juan Humberto');
  });

  it('baja el resto a minúsculas', () => {
    expect(capitalizarNombre('MONRRAZ espinosa')).toBe('Monrraz Espinosa');
  });

  it('colapsa espacios extra y recorta', () => {
    expect(capitalizarNombre('  ana   maria  ')).toBe('Ana Maria');
  });

  it('maneja null/undefined/vacío como cadena vacía', () => {
    expect(capitalizarNombre(null)).toBe('');
    expect(capitalizarNombre(undefined)).toBe('');
    expect(capitalizarNombre('')).toBe('');
  });
});
