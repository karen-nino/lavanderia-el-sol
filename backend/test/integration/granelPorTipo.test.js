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

// Un granel líquido con su tipo (se elige en el producto, mig. 136).
async function granel(nombre, tipoId, stock = 50) {
  const id = await seedProducto({ nombre, precio_unitario: 1, stock_actual: stock });
  await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [id, tipoId]);
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

describe('medidas capturadas al crear la nota', () => {
  it('mandan sobre las de Ajustes; 0 = no lleva de ese tipo', async () => {
    await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    await granel('SE AZUL', tipo.suavizante);
    await granel('SE BLANCO', tipo.suavizante);
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA', granel: [
        { tipo_granel_id: tipo.jabon, cantidad: 3 },
        { tipo_granel_id: tipo.suavizante, cantidad: 0 },
      ] }],
    });
    expect(res.status).toBe(201);
    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.body.cargas[0].pendientes).toEqual([
      expect.objectContaining({ tipo_granel: 'Jabón', cantidad: 3 }),
    ]);
  });

  it('una cantidad que no es entero de 0 o más → 400', async () => {
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA', granel: [{ tipo_granel_id: tipo.jabon, cantidad: -1 }] }],
    });
    expect(res.status).toBe(400);
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

// Mig. 154: el cliente dejó su propio jabón o suavizante.
describe('producto del cliente', () => {
  it('no aparta inventario, devuelve lo que había y deja iniciar la lavadora', async () => {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const lavadora = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const { notaId, carga } = await crearChico();
    const url = `/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`;
    const precioAntes = Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [notaId])).rows[0].precio_total);

    // Primero se había elegido OXXI; luego resulta que el cliente trajo el suyo.
    await request(app).put(url).set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 1 }).expect(200);
    const res = await request(app).put(url).set(auth(admin.token)).send({ del_cliente: true, cantidad: 1 });
    expect(res.status).toBe(200);
    const c = res.body.cargas[0];
    expect(c.pendientes).toEqual([expect.objectContaining({ tipo_granel_id: tipo.jabon, del_cliente: true })]);
    expect(c.productos.some(p => p.producto_id === oxxi)).toBe(false);
    expect(await reservado(oxxi)).toBe(0);
    // El precio del servicio no cambia.
    const precioDespues = Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [notaId])).rows[0].precio_total);
    expect(precioDespues).toBe(precioAntes);

    await request(app).patch(`/api/notas/${notaId}/asignar-maquina`).set(auth(admin.token))
      .send({ maquina_ids: [lavadora], cobrar: false }).expect(200);
    const encender = await request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
      .send({ maquina_id: lavadora });
    expect(encender.status).toBe(200);
  });

  it('se puede volver a elegir un producto del inventario', async () => {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon);
    await granel('PERSIL', tipo.jabon);
    const { notaId, carga } = await crearChico();
    const url = `/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`;
    await request(app).put(url).set(auth(admin.token)).send({ del_cliente: true, cantidad: 1 }).expect(200);
    const res = await request(app).put(url).set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 1 });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].pendientes).toHaveLength(0);
    expect(await reservado(oxxi)).toBe(1);
  });
});

// Mig. 161 (2026-10-11): el granel del servicio se DESCUENTA al terminar la
// primera lavadora de la nota; deja de salir como "apartado" en Inventario.
describe('el granel sale del estante al terminar la lavadora', () => {
  const stock = async (id) => {
    const { rows } = await pool.query('SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [id]);
    return { actual: Number(rows[0].stock_actual), reservado: Number(rows[0].stock_reservado) };
  };
  const movimientos = async (notaId) => (await pool.query(
    'SELECT producto_id, tipo, cantidad_medidas::int AS m FROM producto_movimientos WHERE nota_id = $1 ORDER BY id', [notaId]
  )).rows;

  // Nota Chico con OXXI elegido (1 medida) y una lavadora que ya terminó.
  async function lavadaConOxxi() {
    const oxxi = await granel('OXXI MEJORADO', tipo.jabon, 50);
    await granel('PERSIL', tipo.jabon, 50);
    const lavadora = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const { notaId, carga } = await crearChico();
    await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ producto_id: oxxi, cantidad: 1 }).expect(200);
    expect(await stock(oxxi)).toEqual({ actual: 50, reservado: 1 }); // elegido = apartado
    await request(app).patch(`/api/notas/${notaId}/asignar-maquina`).set(auth(admin.token))
      .send({ maquina_ids: [lavadora], cobrar: false }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadora }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`).set(auth(admin.token))
      .send({ lavadora_id: lavadora }).expect(200);
    return { notaId, carga, oxxi };
  }

  it('al terminar la lavadora se descuenta y deja de estar apartado', async () => {
    const { notaId, oxxi } = await lavadaConOxxi();
    expect(await stock(oxxi)).toEqual({ actual: 49, reservado: 0 });
    expect(await movimientos(notaId)).toEqual([{ producto_id: oxxi, tipo: 'venta', m: 1 }]);
  });

  it('cobrar y entregar después no lo descuentan otra vez', async () => {
    const { notaId, oxxi } = await lavadaConOxxi();
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token))
      .send({ estado: 'LISTA' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token))
      .send({ estado: 'FINALIZADA' }).expect(200);
    expect(await stock(oxxi)).toEqual({ actual: 49, reservado: 0 });
    expect((await movimientos(notaId)).filter(m => m.tipo === 'venta')).toHaveLength(1);
  });

  it('cancelar la nota lo regresa al estante', async () => {
    const { notaId, oxxi } = await lavadaConOxxi();
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token))
      .send({ estado: 'CANCELADA' }).expect(200);
    expect(await stock(oxxi)).toEqual({ actual: 50, reservado: 0 });
    expect((await movimientos(notaId)).map(m => m.tipo)).toEqual(['venta', 'liberacion']);
  });

  it('cambiar de producto ya lavado regresa el anterior y descuenta el nuevo', async () => {
    const { notaId, carga, oxxi } = await lavadaConOxxi();
    const persil = (await pool.query("SELECT id FROM productos WHERE nombre = 'PERSIL'")).rows[0].id;
    await request(app).put(`/api/notas/${notaId}/cargas/${carga.id}/granel/${tipo.jabon}`)
      .set(auth(admin.token)).send({ producto_id: persil, cantidad: 1 }).expect(200);
    expect(await stock(oxxi)).toEqual({ actual: 50, reservado: 0 });
    expect(await stock(persil)).toEqual({ actual: 49, reservado: 0 });
  });

  it('eliminar la nota lo regresa al estante', async () => {
    const { notaId, oxxi } = await lavadaConOxxi();
    await request(app).delete(`/api/notas/${notaId}`).set(auth(admin.token)).expect(204);
    expect(await stock(oxxi)).toEqual({ actual: 50, reservado: 0 });
  });
});
