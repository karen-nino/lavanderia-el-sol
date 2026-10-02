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

// Los dos catálogos de Inventario que nacieron con la mig. 119. Comparten la
// misma fábrica que los de arriba, así que basta un smoke de cada uno más lo
// que sí es propio: el de bolsas es el que valida el alta de un producto.
describe('catálogos de Granel y Bolsas (mig. 119)', () => {
  for (const [endpoint, nombre] of [
    ['graneles-producto', 'Cloro'],
    ['tamanos-bolsa', 'Extra grande'],
  ]) {
    it(`${endpoint}: el admin lo agrega y lo desactiva`, async () => {
      const creado = await request(app).post(`/api/etiquetas/${endpoint}`)
        .set(auth(admin.token)).send({ nombre });
      expect(creado.status).toBe(201);
      expect(creado.body).toMatchObject({ nombre, activo: true });

      const upd = await request(app).put(`/api/etiquetas/${endpoint}/${creado.body.id}`)
        .set(auth(admin.token)).send({ activo: false });
      expect(upd.status).toBe(200);
      expect(upd.body.activo).toBe(false);

      const lista = await request(app).get(`/api/etiquetas/${endpoint}`).set(auth(admin.token));
      expect(lista.body.map(x => x.nombre)).toContain(nombre);
    });

    it(`${endpoint}: un empleado no puede tocarlo`, async () => {
      const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
      await request(app).post(`/api/etiquetas/${endpoint}`)
        .set(auth(empleado.token)).send({ nombre }).expect(403);
    });
  }
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

describe('precio de los tamaños de edredón (mig. 130)', () => {
  it('guarda, cambia y borra el precio de un tamaño', async () => {
    const alta = await request(app).post('/api/etiquetas/tamanos-edredon').set(auth(admin.token))
      .send({ nombre: 'Matrimonial', precio: 200 });
    expect(alta.status).toBe(201);
    expect(Number(alta.body.precio)).toBe(200);

    const cambio = await request(app).put(`/api/etiquetas/tamanos-edredon/${alta.body.id}`)
      .set(auth(admin.token)).send({ precio: 220 });
    expect(cambio.status).toBe(200);
    expect(Number(cambio.body.precio)).toBe(220);

    const vacio = await request(app).put(`/api/etiquetas/tamanos-edredon/${alta.body.id}`)
      .set(auth(admin.token)).send({ precio: '' });
    expect(vacio.status).toBe(200);
    expect(vacio.body.precio).toBeNull();
  });

  it('un precio negativo → 400', async () => {
    const res = await request(app).post('/api/etiquetas/tamanos-edredon').set(auth(admin.token))
      .send({ nombre: 'King', precio: -5 });
    expect(res.status).toBe(400);
  });

  it('los otros catálogos no aceptan precio', async () => {
    const res = await request(app).post('/api/etiquetas/tipos-tela').set(auth(admin.token))
      .send({ nombre: 'Seda', precio: 10 });
    expect(res.status).toBe(201);
    expect(res.body.precio).toBeUndefined();
  });
});

describe('medidas y bolsas de cada tamaño de edredón (mig. 132)', () => {
  it('nacen en 0, y se cambian', async () => {
    const alta = await request(app).post('/api/etiquetas/tamanos-edredon').set(auth(admin.token))
      .send({ nombre: 'King' });
    expect(alta.body.precarga_medidas).toBe(0);
    expect(alta.body.precarga_bolsas).toBe(0);

    const res = await request(app).put(`/api/etiquetas/tamanos-edredon/${alta.body.id}`)
      .set(auth(admin.token)).send({ precarga_medidas: 4, precarga_bolsas: 2 });
    expect(res.status).toBe(200);
    expect(res.body.precarga_medidas).toBe(4);
    expect(res.body.precarga_bolsas).toBe(2);
  });

  it('vacío o negativo → 400', async () => {
    const alta = await request(app).post('/api/etiquetas/tamanos-edredon').set(auth(admin.token))
      .send({ nombre: 'Individual' });
    const vacio = await request(app).put(`/api/etiquetas/tamanos-edredon/${alta.body.id}`)
      .set(auth(admin.token)).send({ precarga_medidas: '' });
    expect(vacio.status).toBe(400);
    const neg = await request(app).put(`/api/etiquetas/tamanos-edredon/${alta.body.id}`)
      .set(auth(admin.token)).send({ precarga_bolsas: -1 });
    expect(neg.status).toBe(400);
  });
});
