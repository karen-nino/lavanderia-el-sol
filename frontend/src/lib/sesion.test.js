// Dónde se guarda la sesión según el entorno. En la DEMO tiene que ser
// sessionStorage: es lo que hace que cerrar la pestaña cierre la sesión y que
// el siguiente visitante no se encuentre dentro con la del anterior.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockEntorno = { ES_DEMO: false };
vi.mock('./entorno', () => ({ get ES_DEMO() { return mockEntorno.ES_DEMO; } }));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});

describe('almacenSesion', () => {
  it('fuera de la demo guarda en localStorage, que sobrevive a cerrar la pestaña', async () => {
    mockEntorno.ES_DEMO = false;
    const { almacenSesion } = await import('./sesion.js');

    almacenSesion.setItem('token', 'abc');
    expect(localStorage.getItem('token')).toBe('abc');
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('en la demo guarda en sessionStorage, que el navegador tira al cerrarla', async () => {
    mockEntorno.ES_DEMO = true;
    const { almacenSesion } = await import('./sesion.js');

    almacenSesion.setItem('token', 'abc');
    expect(sessionStorage.getItem('token')).toBe('abc');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('en la demo limpia la sesión que hubiera quedado en localStorage', async () => {
    localStorage.setItem('token', 'de-una-visita-anterior');
    localStorage.setItem('usuario', '{"id":1}');
    localStorage.setItem('sucursalActiva', 'pruebas');
    localStorage.setItem('otra-cosa', 'no se toca');

    mockEntorno.ES_DEMO = true;
    await import('./sesion.js');

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(localStorage.getItem('sucursalActiva')).toBeNull();
    expect(localStorage.getItem('otra-cosa')).toBe('no se toca');
  });
});
