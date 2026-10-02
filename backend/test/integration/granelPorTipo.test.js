// El granel de un servicio Por Encargo por TIPO (migs. 132-134): el servicio
// sabe cuántas medidas lleva de cada tipo (Jabón, Suavizante) y el empleado
// elige en Salidas cuál producto usa. La lavadora no arranca sin elegir.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente,
  seedMaquina, auth,
} from '../helpers.js';

let admin;
let tipo; // { jabon, suavizante } → ids de tipos_granel

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({ precarga_medidas_chico: 1, precio_carga_mediana: 0, precio_carga_secadora: 0 });
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  const { rows } = await pool.query(
    `INSERT INTO tipos_granel (nombre, orden) VALUES ('Jabón', 1), ('Suavizante', 2) RETURNING id, nombre`
  );
  tipo = { jabon: rows[0].id, suavizante: rows[1].id };
});

// Un granel líquido con su tipo en el catálogo de Granel.
async function granel(nombre, tipoId, stock = 50) {
  await pool.query(
    'INSERT INTO graneles_producto (nombre, tipo_id) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING',
    [nombre, tipoId]
  );
  const id = await seedProducto({ nombre, precio_unitario: 1, stock_actual: stock });
  return id;
}

const crearChico = async () => {
  const clienteId = await seedCliente();
  const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
  });
  expect(res.status).toBe(201);
  const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
  return { notaId: res.body.id, carga: detalle.body.cargas[0] };
};

const reservado = async (id) =>
  Number((await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [id])).rows[0].stock_reservado);

describe('al crear la nota', () => {
  it('con dos jabones queda por elegir; con un solo suavizante entra solo', async () => {
    await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const azul = await granel('SE AZUL', tipo.suavizante);

    const { carga } = await crearChico();
    expect(carga.pendientes).toHaveLength(1);
    expect(carga.pendientes[0]).toMatchObject({ tipo_granel: 'Jabón', cantidad: 1 });
    expect(carga.productos.map(p => p.producto_id)).toEqual([azul]);
    expect(await reservado(azul)).toBe(1);
  });

  it('si no alcanza la existencia, la nota se crea igual y queda por elegir', async () => {
    const azul = await granel('SE AZUL', tipo.suavizante, 0);
    const { carga } = await crearChico();
    expect(carga.pendientes).toHaveLength(1);
    expect(carga.productos).toHaveLength(0);
    expect(await reservado(azul)).toBe(0);
  });

  it('con 0 medidas en el servicio no lleva granel', async () => {
    await seedAjustes({ precarga_medidas_chico: 0 });
    await granel('OXXI MEJORADO', tipo.jabon);
    const { carga } = await crearChico();
    expect(carga.pendientes).toHaveLength(0);
    expect(carga.productos).toHaveLength(0);
  });
});

describe('PUT /notas/:id/cargas/:cargaId/granel/:tipoId', () => {
  it('elige el producto, aparta su existencia y deja de estar pendiente', async () => {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const { notaId, carga } = await crearChico();

    const res = await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 2 });
    expect(res.status).toBe(200);
    const c = res.body.cargas[0];
    expect(c.pendientes).toHaveLength(0);
    expect(c.productos.find(p => p.producto_id === oxxi).cantidad).toBe(2);
    expect(await reservado(oxxi)).toBe(2);
  });

  it('cambiar de producto devuelve lo apartado del anterior', async () => {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon);
    const persil = await granel('PERSIL', tipo.jabon);
    const { notaId, carga } = await crearChico();
    const url = `/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`;

    await request(app).put(url).set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 1 }).expect(200);
    await request(app).put(url).set(auth(admin.token)).send({ producto_id: persil, cantidad: 1 }).expect(200);
    expect(await reservado(oxxi)).toBe(0);
    expect(await reservado(persil)).toBe(1);
  });

  it('no acepta un producto de otro tipo', async () => {
    await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const azul = await granel('SE AZUL', tipo.suavizante);
    const { notaId, carga } = await crearChico();
    const res = await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ producto_id: azul, cantidad: 1 });
    expect(res.status).toBe(400);
  });

  it('sin producto cambia la cantidad de lo que está por elegir', async () => {
    await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const { notaId, carga } = await crearChico();
    const res = await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ cantidad: 3 });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].pendientes[0].cantidad).toBe(3);
  });
});

describe('ninguna lavadora de la nota arranca con granel por elegir', () => {
  it('encender se rechaza hasta elegir, y después sí', async () => {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const lavadora = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const { notaId, carga } = await crearChico();
    // En Por Encargo la lavadora se agrega suelta en Salidas, sin servicio.
    await request(app).patch(`/api/notas/${notaId}/asignar-maquina`).set(auth(admin.token))
      .send({ maquina_ids: [lavadora], cobrar: false }).expect(200);

    const antes = await request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
      .send({ maquina_id: lavadora });
    expect(antes.status).toBe(409);
    expect(antes.body.message).toMatch(/jabón/);

    const iniciar = await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadora });
    expect(iniciar.status).toBe(409);

    await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 1 }).expect(200);
    const despues = await request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
      .send({ maquina_id: lavadora });
    expect(despues.status).toBe(200);
  });
});
