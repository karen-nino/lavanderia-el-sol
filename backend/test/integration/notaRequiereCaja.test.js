import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedProducto, auth } from '../helpers.js';

// Sin caja abierta no se crea nota. Las demás pruebas corren con el candado
// apagado (vitest.integration.config.js); aquí se enciende.
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

describe('Salidas con la caja cerrada', () => {
  // Nota hecha con la caja abierta; luego se cierra el turno.
  const notaYCerrar = async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
    const nota = (await crearNota(admin.token).expect(201)).body;
    await request(app).post('/api/caja/cerrar').set(auth(admin.token))
      .send({ monto_contado: 0, monto_caja_final: 0, monto_sobre: 0 }).expect(200);
    return nota;
  };

  it('no deja asignar ni encender máquinas, ni agregar productos', async () => {
    const nota = await notaYCerrar();
    const lavadora = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const producto = await seedProducto({ nombre: 'Ariel', precio_unitario: 25, precio_botella: 25, tipo_liquido: 'marca' });

    const intentos = [
      request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
        .send({ carga_id: nota.cargas[0].id, slot: 'lavadora', maquina_id: lavadora }),
      request(app).patch(`/api/notas/${nota.id}/encender-maquina`).set(auth(admin.token))
        .send({ maquina_id: lavadora }),
      request(app).post(`/api/notas/${nota.id}/productos`).set(auth(admin.token))
        .send({ producto_id: producto, cantidad: 1 }),
      request(app).patch(`/api/maquinas/${lavadora}/mas-tiempo`).set(auth(admin.token)).send({}),
    ];
    for (const res of await Promise.all(intentos)) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CAJA_CERRADA');
    }
  });

  it('Finalizar y Detener sí se pueden, para terminar lo que quedó corriendo', async () => {
    const nota = await notaYCerrar();
    const lavadora = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const respuestas = await Promise.all([
      request(app).patch(`/api/notas/${nota.id}/terminar-lavado-final`).set(auth(admin.token)).send({}),
      request(app).patch(`/api/notas/${nota.id}/terminar-secado`).set(auth(admin.token)).send({}),
      request(app).patch(`/api/maquinas/${lavadora}/detener-ciclo`).set(auth(admin.token)).send({}),
    ]);
    for (const res of respuestas) expect(res.body.code).not.toBe('CAJA_CERRADA');
  });
});
