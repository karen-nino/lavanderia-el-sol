// Borrar una nota se lleva sus abonos (ON DELETE CASCADE). Si alguno entró en un
// corte cerrado, el corte y Ventas quedarían en desacuerdo: no se permite (como
// con una nota pagada en un corte cerrado, y como al cancelar).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, seedAjustes, auth } from '../helpers.js';

let admin;
let adminMain; // borrar notas es solo del Admin Main
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  adminMain = await seedUsuario({ rol: 'admin_main', sucursal: 'centro', nombre: 'Main' });
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

    const res = await request(app).delete(`/api/notas/${id}`).set(auth(adminMain.token));
    expect(res.status).toBe(409);
    const { rows } = await pool.query('SELECT 1 FROM nota_abonos WHERE nota_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('con la caja todavía abierta sí se borra, como una nota cobrada ahí', async () => {
    const id = await notaConAbono();
    await request(app).delete(`/api/notas/${id}`).set(auth(adminMain.token)).expect(204);
  });

  it('un abono revertido no la bloquea', async () => {
    const id = await notaConAbono();
    const { rows: [ab] } = await pool.query('SELECT id FROM nota_abonos WHERE nota_id = $1', [id]);
    await api('patch', `/api/notas/${id}/abonos/${ab.id}/revertir`, { motivo: 'error' }).expect(200);
    await api('post', '/api/caja/cerrar', { monto_contado: 0 }).expect(200);
    await request(app).delete(`/api/notas/${id}`).set(auth(adminMain.token)).expect(204);
  });
});
