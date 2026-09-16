// Quién sale en la lista de Empleados. La regla dejó la página vacía una vez:
// al abrir el módulo a la demo pública, donde TODOS los usuarios llevan la
// bandera es_prueba —el visitante y el personal que dé de alta—, el filtro que
// reserva esos usuarios al admin_main se los comía a todos, incluida la tarjeta
// de quien estaba mirando.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ES_DEMO se resuelve al importar el módulo, así que se mockea por entorno.
const mockEntorno = { ES_DEMO: false };
vi.mock('./entorno', () => ({ get ES_DEMO() { return mockEntorno.ES_DEMO; } }));

const { empleadoVisible } = await import('./empleados.js');

const MAIN     = { id: 1, nombre: 'Dueña',  rol: 'admin_main', sucursal: null };
const ADMIN    = { id: 2, nombre: 'Ana',    rol: 'admin',      sucursal: null };
const OPERADOR = { id: 3, nombre: 'Beto',   rol: 'operador',   sucursal: 'centro' };
const OTRA     = { id: 4, nombre: 'Caro',   rol: 'operador',   sucursal: 'retiro' };
const PRUEBA   = { id: 5, nombre: 'Prueba', rol: 'admin',      sucursal: 'pruebas', es_prueba: true };

beforeEach(() => { mockEntorno.ES_DEMO = false; });

describe('empleadoVisible fuera de la demo', () => {
  const ctx = { quienMira: ADMIN, sucursalVista: 'centro', esAdminMain: false };

  it('un admin ve a los admins y a los operadores de la sucursal que mira', () => {
    expect(empleadoVisible(ADMIN, ctx)).toBe(true);
    expect(empleadoVisible(OPERADOR, ctx)).toBe(true);
    expect(empleadoVisible(OTRA, ctx)).toBe(false);
  });

  it('los usuarios de prueba siguen siendo solo para el admin_main', () => {
    expect(empleadoVisible(PRUEBA, ctx)).toBe(false);
    expect(empleadoVisible(PRUEBA, { ...ctx, quienMira: MAIN, esAdminMain: true })).toBe(true);
  });

  it('el admin_main se oculta a los demás, pero se ve a sí mismo', () => {
    expect(empleadoVisible(MAIN, ctx)).toBe(false);
    expect(empleadoVisible(MAIN, { ...ctx, quienMira: MAIN, esAdminMain: true })).toBe(true);
  });
});

describe('empleadoVisible en la demo', () => {
  // El visitante: admin del entorno de pruebas, NO admin_main.
  const ctx = { quienMira: PRUEBA, sucursalVista: 'pruebas', esAdminMain: false };

  beforeEach(() => { mockEntorno.ES_DEMO = true; });

  it('el visitante se ve a sí mismo', () => {
    expect(empleadoVisible(PRUEBA, ctx)).toBe(true);
  });

  it('ve al personal que da de alta, que también nace con es_prueba', () => {
    const nuevo = { id: 6, nombre: 'Nuevo', rol: 'operador', sucursal: 'pruebas', es_prueba: true };
    expect(empleadoVisible(nuevo, ctx)).toBe(true);
  });

  it('la lista no sale vacía cuando todos son de prueba', () => {
    const todos = [PRUEBA, { id: 6, nombre: 'Nuevo', rol: 'operador', sucursal: 'pruebas', es_prueba: true }];
    expect(todos.filter((e) => empleadoVisible(e, ctx))).toHaveLength(2);
  });
});
