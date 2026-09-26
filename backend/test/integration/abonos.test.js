import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, seedAjustes, auth,
} from '../helpers.js';

// Abonos (mig. 121): pagos parciales de una nota. El dinero entra el día que se
// abona —y ahí lo cuenta el corte—, y al liquidar entra solo lo que faltaba.
let admin;
let clienteId;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
  clienteId = await seedCliente();
});

// Nota Por Encargo de $100 (el tope de la carga grande), pendiente de cobro.
async function notaDe100() {
  const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE',
    cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana' }],
  });
  expect(res.status).toBe(201);
  expect(Number(res.body.precio_total)).toBe(100);
  return res.body.id;
}

const detalle = (id) => request(app).get(`/api/notas/${id}`).set(auth(admin.token));

describe('POST /api/notas/:id/abonos', () => {
  it('un abono parcial deja la nota pendiente y baja el saldo', async () => {
    const id = await notaDe100();
    const res = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 40, forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(201);
    expect(res.body.nota_pagada).toBe(false);

    const det = await detalle(id);
    expect(det.body.estado_pago).toBe('PENDIENTE');
    expect(Number(det.body.abonado)).toBe(40);
    expect(Number(det.body.saldo)).toBe(60);
    expect(det.body.abonos).toHaveLength(1);
  });

  it('el abono que cubre el saldo deja la nota pagada', async () => {
    const id = await notaDe100();
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 40, forma_pago: 'EFECTIVO' }).expect(201);
    const res = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 60, forma_pago: 'TARJETA' });
    expect(res.status).toBe(201);
    expect(res.body.nota_pagada).toBe(true);

    const det = await detalle(id);
    expect(det.body.estado_pago).toBe('PAGADO');
    expect(det.body.forma_pago).toBe('TARJETA'); // la del abono que la terminó
    expect(Number(det.body.saldo)).toBe(0);
  });

  it('no se puede abonar más de lo que falta', async () => {
    const id = await notaDe100();
    const res = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 150, forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/pasa de lo que falta/i);
  });

  it('una nota ya pagada no recibe abonos', async () => {
    const id = await notaDe100();
    await request(app).patch(`/api/notas/${id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    const res = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 10, forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ya está pagada/i);
  });

  it('el monto y la forma de pago son obligatorios', async () => {
    const id = await notaDe100();
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 0, forma_pago: 'EFECTIVO' }).expect(400);
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 20 }).expect(400);
  });

  it('un empleado también puede abonar', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
    const id = await notaDe100();
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(emp.token)).send({ monto: 25, forma_pago: 'EFECTIVO' }).expect(201);
  });
});

describe('el abono entra en el corte del día que se hizo', () => {
  it('el corte cuenta el abono y, al liquidar, solo lo que faltaba', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 0 }).expect(201);
    const id = await notaDe100();

    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 40, forma_pago: 'EFECTIVO' }).expect(201);

    // Solo con el abono: la caja ya cuenta esos $40 aunque la nota siga debiendo.
    let caja = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(caja.body.totales.ventas).toBe(40);

    // Al liquidarla entran los $60 que faltaban, no los $100 otra vez.
    await request(app).patch(`/api/notas/${id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    caja = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(caja.body.totales.ventas).toBe(100);
    expect(caja.body.totales.ventas_desglose.efectivo).toBe(100);
  });

  it('Ventas dice quién recibió cada abono', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Pedro' });
    const id = await notaDe100();
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(emp.token)).send({ monto: 20, forma_pago: 'EFECTIVO' }).expect(201);

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.body.abonos).toHaveLength(1);
    expect(res.body.abonos[0]).toMatchObject({ monto: 20, forma_pago: 'EFECTIVO', recibio: 'Pedro' });

    // Y el detalle de la nota también lo dice.
    const det = await detalle(id);
    expect(det.body.abonos[0].usuario_nombre).toBe('Pedro');
  });

  it('un abono revertido deja de listarse en Ventas', async () => {
    const id = await notaDe100();
    const abono = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 20, forma_pago: 'EFECTIVO' });
    await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(admin.token)).send({ motivo: 'error' }).expect(200);

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.body.abonos).toEqual([]);
    expect(res.body.tarjetas.total_cobrado).toBe(0);
  });

  it('el resumen de Ventas cuenta lo mismo que la caja', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 0 }).expect(201);
    const id = await notaDe100();
    await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 30, forma_pago: 'TRANSFERENCIA' }).expect(201);

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.tarjetas.total_cobrado).toBe(30);
    expect(res.body.corte.total_transferencia).toBe(30);
  });
});

describe('PATCH /api/notas/:id/abonos/:abonoId/revertir', () => {
  it('revertir un abono lo saca de la caja y devuelve el saldo', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 0 }).expect(201);
    const id = await notaDe100();
    const abono = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 40, forma_pago: 'EFECTIVO' });

    const res = await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(admin.token)).send({ motivo: 'se capturó de más' });
    expect(res.status).toBe(200);

    const det = await detalle(id);
    expect(Number(det.body.abonado)).toBe(0);
    expect(Number(det.body.saldo)).toBe(100);
    expect(det.body.abonos[0].revertido_at).not.toBeNull();

    const caja = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(caja.body.totales.ventas).toBe(0);
  });

  it('si el abono había dejado la nota pagada, vuelve a deber', async () => {
    const id = await notaDe100();
    const abono = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 100, forma_pago: 'EFECTIVO' });
    expect(abono.body.nota_pagada).toBe(true);

    await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(admin.token)).send({ motivo: 'no pagó' }).expect(200);

    const det = await detalle(id);
    expect(det.body.estado_pago).toBe('PENDIENTE');
    expect(Number(det.body.saldo)).toBe(100);
  });

  it('un empleado no puede revertir, y sin motivo tampoco el admin', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
    const id = await notaDe100();
    const abono = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 20, forma_pago: 'EFECTIVO' });

    await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(emp.token)).send({ motivo: 'me equivoqué' }).expect(403);
    await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(admin.token)).send({}).expect(400);
  });

  it('con el corte de ese abono ya cerrado, no se revierte', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 0 }).expect(201);
    const id = await notaDe100();
    const abono = await request(app).post(`/api/notas/${id}/abonos`)
      .set(auth(admin.token)).send({ monto: 40, forma_pago: 'EFECTIVO' });
    await request(app).post('/api/caja/cerrar').set(auth(admin.token))
      .send({ monto_contado: 40 }).expect(200);

    const res = await request(app).patch(`/api/notas/${id}/abonos/${abono.body.id}/revertir`)
      .set(auth(admin.token)).send({ motivo: 'tarde' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya se cerró/i);
  });
});

// El detalle es el que alimenta la pantalla: sin abonos debe verse igual que
// siempre.
describe('una nota sin abonos', () => {
  it('trae la lista vacía y el saldo completo', async () => {
    const id = await notaDe100();
    const det = await detalle(id);
    expect(det.body.abonos).toEqual([]);
    expect(Number(det.body.abonado)).toBe(0);
    expect(Number(det.body.saldo)).toBe(100);
    expect(pool).toBeTruthy();
  });
});
