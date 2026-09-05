import { describe, it, expect } from 'vitest';
import { mensajeDeError } from './api.js';

describe('mensajeDeError', () => {
  it('prefiere el mensaje que manda el backend', () => {
    expect(mensajeDeError(400, { message: 'Nombre es requerido.' })).toBe('Nombre es requerido.');
  });

  it('usa la descripción por código cuando no hay mensaje', () => {
    expect(mensajeDeError(404, {})).toBe('No se encontró la información que pediste. (error 404)');
    expect(mensajeDeError(429, null)).toBe(
      'Demasiados intentos seguidos. Espera un momento y vuelve a intentar. (error 429)'
    );
  });

  it('cae a un genérico para códigos desconocidos', () => {
    expect(mensajeDeError(418, {})).toBe('No se pudo completar la acción. Intenta de nuevo. (error 418)');
  });
});
