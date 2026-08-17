import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, auth, tokenFor } from '../helpers.js';

// Estado por defecto: una sucursal y un admin en ella.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('auth', () => {
  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/caja/actual');
    expect(res.status).toBe(401);
  });

  it('token de un usuario inexistente responde 401', async () => {
    const res = await request(app)
      .get('/api/caja/actual')
      .set(auth(tokenFor(999999)));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/caja/actual', () => {
  it('sin caja abierta devuelve { abierta: false }', async () => {
    const res = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ abierta: false });
  });
});

describe('POST /api/caja/abrir', () => {
  it('abre la caja y luego /actual la refleja', async () => {
    const abrir = await request(app)
      .post('/api/caja/abrir')
      .set(auth(admin.token))
      .send({ monto_inicial: 500, notas: 'apertura de prueba' });
    expect(abrir.status).toBe(201);
    expect(abrir.body.id).toBeTypeOf('number');

    const actual = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(actual.status).toBe(200);
    expect(actual.body.abierta).toBe(true);
    expect(actual.body.caja.monto_inicial).toBe(500);
    expect(actual.body.totales).toEqual({ ventas: 0, entradas: 0, salidas: 0, esperado: 500 });
  });

  it('rechaza un monto inicial inválido con 400', async () => {
    const res = await request(app)
      .post('/api/caja/abrir')
      .set(auth(admin.token))
      .send({ monto_inicial: -1 });
    expect(res.status).toBe(400);
  });

  it('no permite dos cajas abiertas a la vez (409)', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 100 });
    const segunda = await request(app)
      .post('/api/caja/abrir')
      .set(auth(admin.token))
      .send({ monto_inicial: 100 });
    expect(segunda.status).toBe(409);
  });

  it('la caja es compartida entre usuarios de la misma sucursal', async () => {
    const otro = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 100 });
    const segunda = await request(app)
      .post('/api/caja/abrir')
      .set(auth(otro.token))
      .send({ monto_inicial: 100 });
    expect(segunda.status).toBe(409);
  });
});

describe('POST /api/caja/movimientos', () => {
  beforeEach(async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 500 });
  });

  it('registra entradas y salidas y actualiza los totales', async () => {
    await request(app)
      .post('/api/caja/movimientos')
      .set(auth(admin.token))
      .send({ tipo: 'entrada', concepto: 'Fondo extra', monto: 200 })
      .expect(201);
    await request(app)
      .post('/api/caja/movimientos')
      .set(auth(admin.token))
      .send({ tipo: 'salida', concepto: 'Compra jabón', monto: 50 })
      .expect(201);

    const actual = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(actual.body.totales.entradas).toBe(200);
    expect(actual.body.totales.salidas).toBe(50);
    // esperado = inicial 500 + ventas 0 + entradas 200 - salidas 50
    expect(actual.body.totales.esperado).toBe(650);
    expect(actual.body.movimientos).toHaveLength(2);
  });

  it('valida tipo, concepto y monto (400)', async () => {
    await request(app).post('/api/caja/movimientos').set(auth(admin.token))
      .send({ tipo: 'otro', concepto: 'x', monto: 10 }).expect(400);
    await request(app).post('/api/caja/movimientos').set(auth(admin.token))
      .send({ tipo: 'entrada', concepto: '  ', monto: 10 }).expect(400);
    await request(app).post('/api/caja/movimientos').set(auth(admin.token))
      .send({ tipo: 'entrada', concepto: 'x', monto: 0 }).expect(400);
  });
});

describe('POST /api/caja/movimientos sin caja abierta', () => {
  it('responde 409', async () => {
    const res = await request(app)
      .post('/api/caja/movimientos')
      .set(auth(admin.token))
      .send({ tipo: 'entrada', concepto: 'x', monto: 10 });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/caja/cerrar', () => {
  it('cierra con el resumen y la diferencia correctos', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 500 });
    await request(app).post('/api/caja/movimientos').set(auth(admin.token))
      .send({ tipo: 'entrada', concepto: 'Extra', monto: 100 });

    // esperado = 500 + 100 = 600; contado 590 → diferencia -10
    const res = await request(app)
      .post('/api/caja/cerrar')
      .set(auth(admin.token))
      .send({ monto_contado: 590 });
    expect(res.status).toBe(200);
    expect(res.body.resumen).toMatchObject({
      monto_inicial: 500,
      entradas: 100,
      salidas: 0,
      ventas: 0,
      esperado: 600,
      contado: 590,
      diferencia: -10,
    });

    // Tras cerrar, ya no hay caja abierta y aparece en el historial (admin).
    const actual = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(actual.body).toEqual({ abierta: false });

    const historial = await request(app).get('/api/caja/historial').set(auth(admin.token));
    expect(historial.status).toBe(200);
    expect(historial.body).toHaveLength(1);
    expect(historial.body[0].diferencia).toBe(-10);
  });

  it('cerrar sin caja abierta responde 409', async () => {
    const res = await request(app)
      .post('/api/caja/cerrar')
      .set(auth(admin.token))
      .send({ monto_contado: 100 });
    expect(res.status).toBe(409);
  });
});

describe('permisos de historial', () => {
  it('un operador no puede ver el historial (403)', async () => {
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).get('/api/caja/historial').set(auth(operador.token));
    expect(res.status).toBe(403);
  });
});
