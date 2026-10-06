import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, auth } from '../helpers.js';

// Sin caja abierta no se crea ninguna nota (2026-10-06). El resto de las
// pruebas corre con el candado apagado (vitest.integration.config.js); aquí se
// enciende.
let antes;
beforeAll(() => { antes = process.env.NOTA_REQUIERE_CAJA; delete process.env.NOTA_REQUIERE_CAJA; });
afterAll(() => {
  if (antes === undefined) delete process.env.NOTA_REQUIERE_CAJA;
  else process.env.NOTA_REQUIERE_CAJA = antes;
});

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

const crearNota = (token) => request(app).post('/api/notas').set(auth(token)).send({
  tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
  cargas: [{ lavadora_tipo: 'mediana' }],
});

describe('POST /api/notas — exige la caja abierta', () => {
  it('con la caja cerrada responde 409 CAJA_CERRADA y no crea nada', async () => {
    const res = await crearNota(admin.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CAJA_CERRADA');

    const lista = await request(app).get('/api/notas').set(auth(admin.token));
    const notas = Array.isArray(lista.body) ? lista.body : lista.body.notas ?? [];
    expect(notas).toHaveLength(0);
  });

  it('con la caja abierta la nota se crea', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 0 }).expect(201);
    const res = await crearNota(admin.token);
    expect(res.status).toBe(201);
  });

  it('la caja abierta de OTRA sucursal no cuenta', async () => {
    await seedSucursal('norte', 'Norte');
    const delNorte = await seedUsuario({ rol: 'admin', sucursal: 'norte' });
    await request(app).post('/api/caja/abrir').set(auth(delNorte.token, 'norte'))
      .send({ monto_inicial: 0 }).expect(201);

    const res = await crearNota(admin.token);
    expect(res.status).toBe(409);
  });
});
