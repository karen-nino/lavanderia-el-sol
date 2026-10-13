// Una nota entregada se puede reabrir y desde Salidas tocar sus productos
// sueltos, que ya salieron del estante (`consumido_at`): quitarlos los devuelve a
// la existencia y sumar unidades aparta solo las nuevas.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente, auth } from '../helpers.js';

let admin;
let ariel;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({ precio_carga_mediana: 0, precio_carga_secadora: 0 });
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  ariel = await seedProducto({ nombre: 'ARIEL', precio_unitario: 20, precio_botella: 20, tipo_liquido: 'marca', botella_ml: 100, medida_ml: 100, stock_actual: 10 });
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const stock = async () => {
  const { rows } = await pool.query('SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [ariel]);
  return { actual: Number(rows[0].stock_actual), reservado: Number(rows[0].stock_reservado) };
};

async function notaEntregadaYReabierta() {
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
  });
  expect(n.status).toBe(201);
  await api('post', `/api/notas/${n.body.id}/productos`, { producto_id: ariel, cantidad: 2 }).expect(201);
  // Lavada, procesada y cobrada sin caja (el camino de Salidas no importa aquí).
  await pool.query(`UPDATE notas SET estado = 'LISTA', estado_pago = 'PAGADO', forma_pago = 'EFECTIVO' WHERE id = $1`, [n.body.id]);
  await api('patch', `/api/notas/${n.body.id}/estado`, { estado: 'FINALIZADA' }).expect(200);
  expect(await stock()).toEqual({ actual: 8, reservado: 0 });
  await api('patch', `/api/notas/${n.body.id}/reabrir`).expect(200);
  return n.body.id;
}

// El cambio de total la devolvió a PENDIENTE: se cobra otra vez y se entrega.
async function pagarYEntregar(id) {
  await pool.query(`UPDATE notas SET estado_pago = 'PAGADO', forma_pago = 'EFECTIVO' WHERE id = $1`, [id]);
  await api('patch', `/api/notas/${id}/estado`, { estado: 'FINALIZADA' }).expect(200);
}

describe('productos sueltos de una nota reabierta', () => {
  it('quitar uno ya entregado lo devuelve al estante', async () => {
    const id = await notaEntregadaYReabierta();
    await api('delete', `/api/notas/${id}/productos/${ariel}`).expect(204);
    expect(await stock()).toEqual({ actual: 10, reservado: 0 });
  });

  it('cambiar la cantidad de uno ya entregado no deja apartado para siempre', async () => {
    const id = await notaEntregadaYReabierta();
    await api('patch', `/api/notas/${id}/productos/${ariel}`, { cantidad: 3 }).expect(200);
    await pagarYEntregar(id);
    expect(await stock()).toEqual({ actual: 7, reservado: 0 });
  });

  it('pedir más de uno ya entregado sale al volver a entregar', async () => {
    const id = await notaEntregadaYReabierta();
    await api('post', `/api/notas/${id}/productos`, { producto_id: ariel, cantidad: 1 }).expect(201);
    await pagarYEntregar(id);
    expect(await stock()).toEqual({ actual: 7, reservado: 0 });
  });
});
