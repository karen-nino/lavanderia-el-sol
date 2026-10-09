// Abonos y caja (2026-10-08):
//   · sin caja abierta no se recibe un abono (mismo candado que crear nota);
//   · un abono no se revierte si la nota se liquidó en un corte ya cerrado.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
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
const abrirCaja = () => api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);

async function notaEncargo() {
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(n.status).toBe(201);
  return n.body.id;   // total 70
}

describe('con el candado de caja encendido', () => {
  let antes;
  beforeAll(() => { antes = process.env.NOTA_REQUIERE_CAJA; delete process.env.NOTA_REQUIERE_CAJA; });
  afterAll(() => {
    if (antes === undefined) delete process.env.NOTA_REQUIERE_CAJA;
    else process.env.NOTA_REQUIERE_CAJA = antes;
  });

  it('sin caja abierta el abono se rechaza y no se registra', async () => {
    await abrirCaja();
    const id = await notaEncargo();
    const { rows: [caja] } = await pool.query("SELECT id FROM cajas WHERE estado = 'abierta'");
    await pool.query("UPDATE cajas SET estado = 'cerrada', cerrada_at = NOW() WHERE id = $1", [caja.id]);

    const res = await api('post', `/api/notas/${id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CAJA_CERRADA');
    const { rows } = await pool.query('SELECT 1 FROM nota_abonos WHERE nota_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('tampoco se puede marcar pagada una nota que debe, sin caja', async () => {
    await abrirCaja();
    const id = await notaEncargo();
    await pool.query("UPDATE cajas SET estado = 'cerrada', cerrada_at = NOW()");
    const res = await api('patch', `/api/notas/${id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CAJA_CERRADA');
  });

  it('una nota que ya no debe nada sí se marca pagada sin caja', async () => {
    await abrirCaja();
    const id = await notaEncargo();
    await api('post', `/api/notas/${id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
    await api('patch', `/api/notas/${id}/ajuste`, { ajuste: -40 }).expect(200);   // total 30 = abonado
    await pool.query("UPDATE cajas SET estado = 'cerrada', cerrada_at = NOW()");
    await api('patch', `/api/notas/${id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
  });

  it('con la caja abierta el abono entra a esa caja', async () => {
    await abrirCaja();
    const id = await notaEncargo();
    await api('post', `/api/notas/${id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
    const { rows } = await pool.query('SELECT caja_id FROM nota_abonos WHERE nota_id = $1', [id]);
    expect(rows[0].caja_id).not.toBeNull();
  });
});

describe('revertir un abono', () => {
  it('no se puede si la nota se liquidó en un corte ya cerrado', async () => {
    const id = await notaEncargo();
    // Abono sin caja (como los de antes del candado).
    await api('post', `/api/notas/${id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
    // Se liquida en una caja que después se cierra.
    await abrirCaja();
    await api('post', `/api/notas/${id}/abonos`, { monto: 40, forma_pago: 'EFECTIVO' }).expect(201);
    const { rows: [nota] } = await pool.query('SELECT estado_pago FROM notas WHERE id = $1', [id]);
    expect(nota.estado_pago).toBe('PAGADO');
    await pool.query("UPDATE cajas SET estado = 'cerrada', cerrada_at = NOW()");

    const { rows: [sinCaja] } = await pool.query(
      'SELECT id FROM nota_abonos WHERE nota_id = $1 AND caja_id IS NULL', [id]);
    const res = await api('patch', `/api/notas/${id}/abonos/${sinCaja.id}/revertir`, { motivo: 'error' });
    expect(res.status).toBe(409);
    const { rows: [despues] } = await pool.query('SELECT estado_pago FROM notas WHERE id = $1', [id]);
    expect(despues.estado_pago).toBe('PAGADO');
  });

  it('con la caja de la liquidación abierta sí se puede', async () => {
    await abrirCaja();
    const id = await notaEncargo();
    await api('post', `/api/notas/${id}/abonos`, { monto: 70, forma_pago: 'EFECTIVO' }).expect(201);
    const { rows: [ab] } = await pool.query('SELECT id FROM nota_abonos WHERE nota_id = $1', [id]);
    await api('patch', `/api/notas/${id}/abonos/${ab.id}/revertir`, { motivo: 'error' }).expect(200);
  });
});
