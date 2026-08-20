import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/maquinas — aislamiento por sucursal', () => {
  it('solo lista las máquinas de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedMaquina({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedMaquina({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/maquinas').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });
});

describe('POST /api/maquinas — validaciones', () => {
  it('crea una máquina', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('L9');
    expect(res.body.sucursal).toBe('centro');
  });

  it('sin nombre o tipo → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo/i);
  });

  it('tipo inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'planchadora' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo inválido/i);
  });

  it('tamaño inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'gigante' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tamaño inválido/i);
  });
});

describe('PATCH /api/maquinas/:id/estado', () => {
  it('cambia el estado a mantenimiento', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'mantenimiento' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('mantenimiento');
  });

  it('estado inválido → 400', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'roto' });
    expect(res.status).toBe(400);
  });

  it('máquina inexistente → 404', async () => {
    const res = await request(app).patch('/api/maquinas/999999/estado').set(auth(admin.token))
      .send({ estado: 'disponible' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/maquinas/:id', () => {
  it('un empleado no puede eliminar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(empleado.token));
    expect(res.status).toBe(403);
  });

  it('el admin elimina una máquina', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(admin.token));
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT id FROM maquinas WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('una máquina de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajena = await seedMaquina({ nombre: 'Ajena', sucursal: 'norte' });
    const res = await request(app).delete(`/api/maquinas/${ajena}`).set(auth(admin.token, 'centro'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/maquinas/:id/detener-ciclo — permiso por tipo', () => {
  it('un empleado NO puede detener una lavadora (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/administrador/i);
  });

  it('un empleado SÍ puede detener una secadora (200)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).patch(`/api/maquinas/${sec}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(200);
  });

  it('un admin SÍ puede detener una lavadora (200)', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(admin.token));
    expect(res.status).toBe(200);
  });
});
