import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth, tokenFor } from '../helpers.js';

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
    // Desde la mig. 090 el corte separa el efectivo de transferencias y tarjetas.
    expect(actual.body.totales).toEqual({
      ventas: 0, entradas: 0, salidas: 0, esperado: 500,
      ventas_desglose: { efectivo: 0, transferencia: 0, tarjeta: 0, total: 0 },
    });
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

  // Migración 090: al cajón solo entra el efectivo. Contar transferencias y
  // tarjetas hacía que el corte marcara un faltante inexistente a costa del
  // empleado en turno. El total del día sí las suma, pero aparte.
  it('el esperado del cajón solo cuenta el efectivo, no transferencias ni tarjetas', async () => {
    await seedAjustes({ precio_carga_mediana: 70 });
    const cobrar = async (nombre, forma_pago) => {
      const lavadoraId = await seedMaquina({ nombre, tipo: 'lavadora_mediana' });
      await request(app).post('/api/notas').set(auth(admin.token)).send({
        tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago,
        cargas: [{ lavadora_id: lavadoraId, lavadora_tipo: 'mediana' }],
      }).expect(201);
    };
    await cobrar('L-efec', 'EFECTIVO');
    await cobrar('L-tran', 'TRANSFERENCIA');
    await cobrar('L-tarj', 'TARJETA');

    const { totales } = (await request(app).get('/api/caja/actual').set(auth(admin.token))).body;
    expect(totales.ventas).toBe(210);                    // el día vendió 210…
    expect(totales.ventas_desglose).toMatchObject({ efectivo: 70, transferencia: 70, tarjeta: 70 });
    expect(totales.esperado).toBe(570);                  // …pero al cajón solo entraron 70 (500 + 70)
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

describe('DELETE /api/caja/historial/:id (eliminar corte)', () => {
  // Abre y cierra una caja para dejar un corte en el historial; devuelve su id.
  async function cerrarUnCorte() {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 100 });
    await request(app).post('/api/caja/cerrar').set(auth(admin.token)).send({ monto_contado: 100 });
    const historial = await request(app).get('/api/caja/historial').set(auth(admin.token));
    return historial.body[0].id;
  }

  it('un admin normal no puede eliminar un corte (requiere admin_main → 403)', async () => {
    const corteId = await cerrarUnCorte();
    const res = await request(app).delete(`/api/caja/historial/${corteId}`).set(auth(admin.token));
    expect(res.status).toBe(403);
  });

  it('el admin_main elimina un corte y desaparece del historial', async () => {
    const corteId = await cerrarUnCorte();
    const adminMain = await seedUsuario({ rol: 'admin_main', sucursal: 'centro', nombre: 'Jefe' });

    const res = await request(app).delete(`/api/caja/historial/${corteId}`).set(auth(adminMain.token, 'centro'));
    expect(res.status).toBe(204);

    const historial = await request(app).get('/api/caja/historial').set(auth(admin.token));
    expect(historial.body.map((c) => c.id)).not.toContain(corteId);
  });
});

// El corte se calculaba cada vez preguntando "¿qué notas pagadas caen entre la
// apertura y el cierre?". Revertir un pago viejo sacaba esa venta de la ventana
// y un corte YA CERRADO aparecía con un faltante que nadie causó ese día.
describe('un corte cerrado no cambia después (mig. 101)', () => {
  async function cobrar(monto = 70) {
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(nota.status).toBe(201);
    expect(Number(nota.body.precio_total)).toBe(monto);
    return nota.body.id;
  }

  it('revertir el pago de una nota vieja no toca el corte ya cerrado', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
    const notaId = await cobrar();
    const cierre = await request(app).post('/api/caja/cerrar').set(auth(admin.token))
      .send({ monto_contado: 70 });
    expect(cierre.body.resumen.diferencia).toBe(0); // cuadró aquel día

    // Días después alguien revierte ese cobro.
    await request(app).patch(`/api/notas/${notaId}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PENDIENTE' }).expect(200);

    const hist = await request(app).get('/api/caja/historial').set(auth(admin.token));
    const corte = hist.body[0];
    expect(corte.ventas).toBe(70);      // sigue diciendo lo que se vendió ese día
    expect(corte.esperado).toBe(70);
    expect(corte.diferencia).toBe(0);   // y sigue cuadrando
  });

  it('cada cobro cuenta en SU sesión, no en la que esté abierta al mirarlo', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
    await cobrar();
    await request(app).post('/api/caja/cerrar').set(auth(admin.token)).send({ monto_contado: 70 }).expect(200);

    // Segunda sesión con su propia venta.
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
    await cobrar();
    const actual = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(actual.body.totales.ventas).toBe(70); // solo la suya, no 140
  });

  it('un cobro hecho sin caja abierta no se cuela en la siguiente sesión', async () => {
    await cobrar(); // nadie abrió caja todavía

    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
    const actual = await request(app).get('/api/caja/actual').set(auth(admin.token));
    expect(actual.body.totales.ventas).toBe(0);
  });
});
