// Un descuento no puede dejar la nota en números rojos: `ajustarNota` ya lo
// revisaba, pero el total también se recalcula al quitar o reducir lo que la
// nota lleva, y ahí el descuento que ya estaba puesto lo podía dejar negativo
// (2026-10-12).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente, auth } from '../helpers.js';

let admin;
let ariel;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({});
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  ariel = await seedProducto({ nombre: 'ARIEL', precio_unitario: 20, precio_botella: 20, tipo_liquido: 'marca', stock_actual: 10 });
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const total = async (id) => Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [id])).rows[0].precio_total);

async function notaConDescuento() {
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(n.status).toBe(201);
  await api('post', `/api/notas/${n.body.id}/productos`, { producto_id: ariel, cantidad: 2 }).expect(201);
  const conProducto = await total(n.body.id);
  // Descuento que deja la nota en $10.
  await api('patch', `/api/notas/${n.body.id}/ajuste`, { ajuste: -(conProducto - 10) }).expect(200);
  expect(await total(n.body.id)).toBe(10);
  return n.body.id;
}

describe('el total de la nota nunca queda negativo', () => {
  it('quitar un producto que el descuento ya cubría se rechaza', async () => {
    const id = await notaConDescuento();
    const res = await api('delete', `/api/notas/${id}/productos/${ariel}`);
    expect(res.status).toBe(400);
    expect(await total(id)).toBe(10);
  });

  it('bajar la cantidad por debajo del descuento se rechaza', async () => {
    const id = await notaConDescuento();
    const res = await api('patch', `/api/notas/${id}/productos/${ariel}`, { cantidad: 1 });
    expect(res.status).toBe(400);
    expect(await total(id)).toBe(10);
  });
});
