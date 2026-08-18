import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro', 'Centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/sucursales', () => {
  it('lista las sucursales', async () => {
    const res = await request(app).get('/api/sucursales').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.slug)).toContain('centro');
  });
});

describe('POST /api/sucursales', () => {
  it('el admin crea una sucursal con slug derivado del nombre', async () => {
    const res = await request(app).post('/api/sucursales').set(auth(admin.token))
      .send({ nombre: 'Retiro' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('retiro');
    expect(res.body.activa).toBe(true);
  });

  it('genera un slug único cuando el nombre choca', async () => {
    const res = await request(app).post('/api/sucursales').set(auth(admin.token))
      .send({ nombre: 'Centro' }); // ya existe slug "centro"
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('centro_2');
  });

  it('nombre vacío → 400', async () => {
    const res = await request(app).post('/api/sucursales').set(auth(admin.token))
      .send({ nombre: '   ' });
    expect(res.status).toBe(400);
  });

  it('un empleado no puede crear (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).post('/api/sucursales').set(auth(empleado.token))
      .send({ nombre: 'Retiro' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/sucursales/:slug', () => {
  it('el admin actualiza el nombre', async () => {
    const res = await request(app).patch('/api/sucursales/centro').set(auth(admin.token))
      .send({ nombre: 'Centro Histórico' });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Centro Histórico');
  });

  it('un empleado no puede actualizar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).patch('/api/sucursales/centro').set(auth(empleado.token))
      .send({ nombre: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/sucursales/:slug/activa', () => {
  it('un admin normal no puede activar/desactivar (requiere admin_main → 403)', async () => {
    const res = await request(app).patch('/api/sucursales/centro/activa').set(auth(admin.token))
      .send({ activa: false });
    expect(res.status).toBe(403);
  });
});
