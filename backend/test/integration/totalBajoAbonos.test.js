// Ningún cambio puede dejar el total de una nota por debajo de lo que el
// cliente ya abonó (2026-10-08): el corte esperaba menos dinero del que entró
// y nadie sabía que había que devolverle la diferencia.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, seedAjustes, auth } from '../helpers.js';

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({});
  await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const total = async (id) => Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [id])).rows[0].precio_total);

async function notaConAbono(monto) {
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(n.status).toBe(201);
  await api('post', `/api/notas/${n.body.id}/abonos`, { monto, forma_pago: 'EFECTIVO' }).expect(201);
  return n.body.id;
}

describe('total por debajo de lo abonado', () => {
  it('un descuento que lo deja debajo se rechaza con el motivo', async () => {
    const id = await notaConAbono(60);                 // total 70
    const res = await api('patch', `/api/notas/${id}/ajuste`, { ajuste: -30 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya abonó \$60\.00/);
    expect(await total(id)).toBe(70);                  // no se movió nada
  });

  it('un descuento que no baja de lo abonado sí pasa', async () => {
    const id = await notaConAbono(60);
    await api('patch', `/api/notas/${id}/ajuste`, { ajuste: -10 }).expect(200);
    expect(await total(id)).toBe(60);
  });

  it('revertido el abono, el descuento ya se puede hacer', async () => {
    const id = await notaConAbono(60);
    const { rows } = await pool.query('SELECT id FROM nota_abonos WHERE nota_id = $1', [id]);
    await api('patch', `/api/notas/${id}/abonos/${rows[0].id}/revertir`, { motivo: 'devolución' }).expect(200);
    await api('patch', `/api/notas/${id}/ajuste`, { ajuste: -30 }).expect(200);
    expect(await total(id)).toBe(40);
  });
});
