import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // La BD de test trunca ajustes: se siembra la fila id=1 para poder leerla/editarla.
  await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 150 });
});

describe('GET /api/ajustes', () => {
  it('devuelve la fila de ajustes', async () => {
    const res = await request(app).get('/api/ajustes').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_carga_mediana)).toBe(70);
    expect(Number(res.body.tope_carga_grande)).toBe(150);
  });
});

describe('PATCH /api/ajustes', () => {
  it('un empleado no puede modificar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).patch('/api/ajustes').set(auth(empleado.token))
      .send({ precio_carga_mediana: 99 });
    expect(res.status).toBe(403);
  });

  it('el admin actualiza un precio', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ precio_carga_mediana: 85 });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_carga_mediana)).toBe(85);
  });

  it('rechaza un precio negativo → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ precio_carga_mediana: -1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mayor o igual a 0/i);
  });

  it('rechaza un tiempo menor a 1 minuto → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tiempo_carga_mediana: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/entero mayor o igual a 1/i);
  });

  it('un tope vacío ("") lo quita (queda en null)', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tope_carga_grande: '' });
    expect(res.status).toBe(200);
    expect(res.body.tope_carga_grande).toBeNull();
  });

  it('sin campos para actualizar → 400', async () => {
    const res = await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no hay campos/i);
  });
});
