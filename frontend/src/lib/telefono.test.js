import { describe, it, expect } from 'vitest';
import { formatTelefono } from './telefono.js';

describe('formatTelefono', () => {
  it('formatea 10 dígitos como XX-XXXX-XXXX', () => {
    expect(formatTelefono('3312345678')).toBe('33-1234-5678');
  });

  it('trunca a 10 dígitos', () => {
    expect(formatTelefono('33123456789999')).toBe('33-1234-5678');
  });

  it('ignora caracteres no numéricos', () => {
    expect(formatTelefono('(33) 1234-5678')).toBe('33-1234-5678');
  });

  it('formatea parcialmente mientras se escribe', () => {
    expect(formatTelefono('3')).toBe('3');
    expect(formatTelefono('33')).toBe('33');
    expect(formatTelefono('331')).toBe('33-1');
    expect(formatTelefono('331234')).toBe('33-1234');
    expect(formatTelefono('3312345')).toBe('33-1234-5');
  });

  it('null/undefined/vacío → cadena vacía', () => {
    expect(formatTelefono(null)).toBe('');
    expect(formatTelefono(undefined)).toBe('');
    expect(formatTelefono('')).toBe('');
  });
});
