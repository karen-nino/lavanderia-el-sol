import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedLogin, auth } from '../helpers.js';

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
});

function login(usuario_id, password) {
  return request(app).post('/api/auth/login').send({ usuario_id, password });
}

describe('POST /api/auth/login', () => {
  it('con credenciales correctas devuelve token y usuario', async () => {
    const u = await seedLogin({ rol: 'admin', password: 'secret123' });
    const res = await login(u.id, 'secret123');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.usuario.rol).toBe('admin');
    expect(res.body.usuario.id).toBe(u.id);
  });

  it('con contraseña incorrecta → 401', async () => {
    const u = await seedLogin({ password: 'secret123' });
    const res = await login(u.id, 'otra');
    expect(res.status).toBe(401);
  });

  it('con usuario inexistente → 401', async () => {
    const res = await login(999999, 'secret123');
    expect(res.status).toBe(401);
  });

  it('sin credenciales → 400', async () => {
    const res = await login(undefined, undefined);
    expect(res.status).toBe(400);
  });
});

describe('sesión única por cuenta', () => {
  it('iniciar sesión de nuevo invalida el token anterior', async () => {
    const u = await seedLogin({ password: 'secret123' });

    const primera = await login(u.id, 'secret123');
    const tokenViejo = primera.body.token;

    const segunda = await login(u.id, 'secret123');
    const tokenNuevo = segunda.body.token;

    // El token viejo ya no sirve; el nuevo sí.
    const conViejo = await request(app).get('/api/auth/me').set(auth(tokenViejo));
    expect(conViejo.status).toBe(401);
    expect(conViejo.body.message).toMatch(/otro dispositivo/i);

    const conNuevo = await request(app).get('/api/auth/me').set(auth(tokenNuevo));
    expect(conNuevo.status).toBe(200);
    expect(conNuevo.body.id).toBe(u.id);
  });
});

describe('GET /api/auth/me', () => {
  it('sin token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('con token válido devuelve al usuario', async () => {
    const u = await seedLogin({ rol: 'operador', password: 'secret123' });
    const { body } = await login(u.id, 'secret123');
    const res = await request(app).get('/api/auth/me').set(auth(body.token));
    expect(res.status).toBe(200);
    expect(res.body.rol).toBe('operador');
  });
});

describe('GET /api/auth/buscar-usuarios', () => {
  it('encuentra por nombre a un empleado normal, con mínimo 2 caracteres', async () => {
    await seedLogin({ nombre: 'Juan', rol: 'operador' });

    const corto = await request(app).get('/api/auth/buscar-usuarios?q=J');
    expect(corto.body).toEqual([]); // 1 carácter: no lista

    const res = await request(app).get('/api/auth/buscar-usuarios?q=Ju');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.nombre)).toContain('Juan');
  });

  it('los usuarios ocultos (es_prueba) solo aparecen con el prefijo ***', async () => {
    await pool.query(
      `INSERT INTO usuarios (nombre, password, rol, sucursal, activo, es_prueba)
       VALUES ('Prueba Admin', 'x', 'admin', 'centro', TRUE, TRUE)`
    );

    const normal = await request(app).get('/api/auth/buscar-usuarios?q=Prueba');
    expect(normal.body.map((r) => r.nombre)).not.toContain('Prueba Admin');

    const oculto = await request(app).get('/api/auth/buscar-usuarios?q=***Prueba');
    expect(oculto.body.map((r) => r.nombre)).toContain('Prueba Admin');
  });
});
