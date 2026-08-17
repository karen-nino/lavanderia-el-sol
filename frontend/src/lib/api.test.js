import { describe, it, expect } from 'vitest';
import { mensajeDeError } from './api.js';

describe('mensajeDeError', () => {
  it('prefiere el mensaje que manda el backend', () => {
    expect(mensajeDeError(400, { message: 'Nombre es requerido.' })).toBe('Nombre es requerido.');
  });

  it('usa la descripción por código cuando no hay mensaje', () => {
    expect(mensajeDeError(404, {})).toBe('Error 404: no se encontró la información solicitada.');
    expect(mensajeDeError(429, null)).toBe(
      'Error 429: demasiados intentos seguidos, espera un momento y vuelve a intentar.'
    );
  });

  it('cae a un genérico para códigos desconocidos', () => {
    expect(mensajeDeError(418, {})).toBe('Error 418: ocurrió un error en la solicitud.');
  });
});
