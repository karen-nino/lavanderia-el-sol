import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedInsumo, seedMaquina, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('POST /api/insumos — validaciones', () => {
  it('crea un insumo', async () => {
    const res = await request(app).post('/api/insumos').set(auth(admin.token))
      .send({ nombre: 'Jabón', unidad: 'litro', stock_actual: 10 });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Jabón');
    expect(res.body.sucursal).toBe('centro');
  });

  it('sin nombre o unidad → 400', async () => {
    const res = await request(app).post('/api/insumos').set(auth(admin.token))
      .send({ nombre: 'Jabón' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unidad/i);
  });
});

describe('GET /api/insumos — aislamiento por sucursal', () => {
  it('solo lista los insumos de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedInsumo({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedInsumo({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/insumos').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });
});

describe('POST /api/insumos/:id/movimiento', () => {
  it('una entrada sube el stock', async () => {
    const id = await seedInsumo({ stock_actual: 10 });
    const res = await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', cantidad: 5 });
    expect(res.status).toBe(201);
    expect(Number(res.body.stock_actual)).toBe(15);
  });

  it('una salida baja el stock', async () => {
    const id = await seedInsumo({ stock_actual: 10 });
    const res = await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', cantidad: 4 });
    expect(res.status).toBe(201);
    expect(Number(res.body.stock_actual)).toBe(6);
  });

  it('una salida sin stock suficiente → 400', async () => {
    const id = await seedInsumo({ stock_actual: 3 });
    const res = await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', cantidad: 5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stock insuficiente/i);
  });

  it('tipo inválido → 400', async () => {
    const id = await seedInsumo();
    const res = await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'ajuste', cantidad: 1 });
    expect(res.status).toBe(400);
  });

  it('cantidad no positiva → 400', async () => {
    const id = await seedInsumo();
    const res = await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', cantidad: 0 });
    expect(res.status).toBe(400);
  });

  it('insumo inexistente → 404', async () => {
    const res = await request(app).post('/api/insumos/999999/movimiento').set(auth(admin.token))
      .send({ tipo: 'entrada', cantidad: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/insumos/:id', () => {
  it('un empleado no puede eliminar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedInsumo();
    const res = await request(app).delete(`/api/insumos/${id}`).set(auth(empleado.token));
    expect(res.status).toBe(403);
  });

  it('elimina un insumo sin movimientos', async () => {
    const id = await seedInsumo();
    const res = await request(app).delete(`/api/insumos/${id}`).set(auth(admin.token));
    expect(res.status).toBe(204);
  });

  it('no elimina un insumo con movimientos registrados (409)', async () => {
    const id = await seedInsumo({ stock_actual: 10 });
    await request(app).post(`/api/insumos/${id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', cantidad: 2 }).expect(201);
    const res = await request(app).delete(`/api/insumos/${id}`).set(auth(admin.token));
    expect(res.status).toBe(409);
  });
});

describe('consumo de insumos al crear una nota', () => {
  it('una nota con insumos descuenta su stock', async () => {
    const insumoId = await seedInsumo({ stock_actual: 10 });

    await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
      insumos: [{ insumo_id: insumoId, cantidad: 3 }],
    }).expect(201);

    const { rows } = await pool.query('SELECT stock_actual FROM insumos WHERE id = $1', [insumoId]);
    expect(Number(rows[0].stock_actual)).toBe(7);
  });
});
