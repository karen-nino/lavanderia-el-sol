import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, auth } from '../helpers.js';

// Los 4 catálogos (tipos-tela, tamanos-edredon, marcas-producto,
// envases-producto) comparten la misma fábrica CRUD; se prueba uno
// representativo (tipos-tela) más un smoke de otro catálogo.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

const crear = (token, nombre) =>
  request(app).post('/api/etiquetas/tipos-tela').set(auth(token)).send({ nombre });

describe('POST /api/etiquetas/tipos-tela', () => {
  it('el admin crea una etiqueta', async () => {
    const res = await crear(admin.token, 'Mezclilla');
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Mezclilla');
  });

  it('un empleado no puede crear (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await crear(empleado.token, 'Mezclilla');
    expect(res.status).toBe(403);
  });

  it('nombre vacío → 400', async () => {
    const res = await crear(admin.token, '   ');
    expect(res.status).toBe(400);
  });

  it('nombre duplicado → 409', async () => {
    await crear(admin.token, 'Algodón').expect(201);
    const res = await crear(admin.token, 'Algodón');
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/etiquetas/tipos-tela/:id', () => {
  it('renombra una etiqueta', async () => {
    const { body } = await crear(admin.token, 'Lino');
    const res = await request(app).put(`/api/etiquetas/tipos-tela/${body.id}`).set(auth(admin.token))
      .send({ nombre: 'Lino fino' });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Lino fino');
  });

  it('etiqueta inexistente → 404', async () => {
    const res = await request(app).put('/api/etiquetas/tipos-tela/999999').set(auth(admin.token))
      .send({ nombre: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/etiquetas/tipos-tela/reordenar', () => {
  it('reordena el catálogo según la lista de ids', async () => {
    const a = (await crear(admin.token, 'A')).body;
    const b = (await crear(admin.token, 'B')).body;
    // Se crearon A(orden 1), B(orden 2). Se invierte.
    const res = await request(app).patch('/api/etiquetas/tipos-tela/reordenar').set(auth(admin.token))
      .send({ ids: [b.id, a.id] });
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('sin ids → 400', async () => {
    const res = await request(app).patch('/api/etiquetas/tipos-tela/reordenar').set(auth(admin.token))
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/etiquetas/marcas-producto', () => {
  it('devuelve el catálogo (otro catálogo, misma fábrica)', async () => {
    await request(app).post('/api/etiquetas/marcas-producto').set(auth(admin.token))
      .send({ nombre: 'Ariel' }).expect(201);
    const res = await request(app).get('/api/etiquetas/marcas-producto').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.map((m) => m.nombre)).toContain('Ariel');
  });
});
