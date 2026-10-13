// Borrar una nota se lleva sus abonos (ON DELETE CASCADE). Si alguno entró en
// un corte ya CERRADO, el corte conserva ese dinero y Ventas lo pierde: dos
// reportes del mismo día en desacuerdo. Es la misma regla que ya protegía a la
// nota PAGADA de un corte cerrado (2026-09-23) y la que cancelar aplica a
// cualquier abono vivo (2026-10-12).
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
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

async function notaConAbono() {
  await api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(n.status).toBe(201);
  await api('post', `/api/notas/${n.body.id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
  return n.body.id;
}

describe('eliminar una nota con abonos', () => {
  it('no se borra si un abono quedó en un corte cerrado', async () => {
    const id = await notaConAbono();
    await api('post', '/api/caja/cerrar', { monto_contado: 30 }).expect(200);

    const res = await api('delete', `/api/notas/${id}`);
    expect(res.status).toBe(409);
    const { rows } = await pool.query('SELECT 1 FROM nota_abonos WHERE nota_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('con la caja todavía abierta sí se borra, como una nota cobrada ahí', async () => {
    const id = await notaConAbono();
    await api('delete', `/api/notas/${id}`).expect(204);
  });

  it('un abono revertido no la bloquea', async () => {
    const id = await notaConAbono();
    const { rows: [ab] } = await pool.query('SELECT id FROM nota_abonos WHERE nota_id = $1', [id]);
    await api('patch', `/api/notas/${id}/abonos/${ab.id}/revertir`, { motivo: 'error' }).expect(200);
    await api('post', '/api/caja/cerrar', { monto_contado: 0 }).expect(200);
    await api('delete', `/api/notas/${id}`).expect(204);
  });
});
