// Tiempos de ciclo por marca y tamaño (mig. 107).
//
// La duración de un ciclo es de la MÁQUINA y no de la carga: en la lavandería
// las medianas son LG y tardan 45 min, y las jumbo son Speed Queen y tardan 35
// — al revés de lo que suponía el eje del tamaño, que daba por hecho que una
// jumbo tarda más. Estas pruebas fijan que manda la marca, que sin marca se
// conserva el comportamiento anterior, y que el edredón dejó de tener tiempo
// propio.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina,
  seedCliente, seedAjustes, auth,
} from '../helpers.js';

let admin;

// Tiempos por tamaño bien distintos de los de marca, para que la prueba falle
// si el cálculo se cae al respaldo cuando no debía.
const RESPALDO_MEDIANA = 30;
const RESPALDO_JUMBO = 99;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({
    tiempo_carga_mediana: RESPALDO_MEDIANA,
    tiempo_carga_jumbo: RESPALDO_JUMBO,
    tiempo_carga_secadora: 20,
  });
});

async function seedMarca(nombre) {
  const { rows } = await pool.query(
    `INSERT INTO marcas_maquina (nombre, orden)
     VALUES ($1, (SELECT COALESCE(MAX(orden), 0) + 1 FROM marcas_maquina))
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [nombre]
  );
  return rows[0].id;
}

const ponerMarca = (maquinaId, marca) =>
  pool.query('UPDATE maquinas SET marca = $1 WHERE id = $2', [marca, maquinaId]);

const tiempoDe = (marcaId, tipo, tamano, minutos) =>
  pool.query(
    `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos) VALUES ($1, $2, $3, $4)
     ON CONFLICT (marca_id, tipo, tamano) DO UPDATE SET minutos = EXCLUDED.minutos`,
    [marcaId, tipo, tamano, minutos]
  );

const cicloDe = async (maquinaId) => {
  const { rows } = await pool.query('SELECT ciclo_minutos FROM maquinas WHERE id = $1', [maquinaId]);
  return rows[0].ciclo_minutos;
};

// Crea una nota de autoservicio ya pagada, le asigna la lavadora y la arranca:
// es el camino que sella el ciclo.
async function arrancar(lavadoraId, extraCarga = {}) {
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO',
    tipo_prenda: 'ROPA',
    estado_pago: 'PAGADO',
    forma_pago: 'EFECTIVO',
    cargas: [{ lavadora_tipo: 'mediana', ...extraCarga }],
  });
  expect(creada.status).toBe(201);
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
  await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: lavadoraId }).expect(200);
  return creada.body.id;
}

describe('sellado del ciclo — manda la marca de la máquina', () => {
  it('una LG mediana toma los 45 min de su marca, no los 30 de su tamaño', async () => {
    const lg = await seedMarca('LG');
    await tiempoDe(lg, 'lavadora', 'mediana', 45);
    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await ponerMarca(lavadoraId, 'LG');

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('una Speed Queen jumbo toma 35 aunque su tamaño diga 99', async () => {
    const sq = await seedMarca('Speed Queen');
    await tiempoDe(sq, 'lavadora', 'jumbo', 35);
    const lavadoraId = await seedMaquina({ nombre: 'L8', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    await ponerMarca(lavadoraId, 'Speed Queen');

    await arrancar(lavadoraId, { lavadora_tipo: 'jumbo' });

    expect(await cicloDe(lavadoraId)).toBe(35);
  });

  it('sin marca sigue mandando el tamaño: nada cambia para las máquinas de siempre', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(RESPALDO_MEDIANA);
  });

  it('con marca pero sin esa combinación configurada, cae al tamaño', async () => {
    const lg = await seedMarca('LG');
    // Configurada la jumbo, pero la máquina es mediana.
    await tiempoDe(lg, 'lavadora', 'jumbo', 45);
    const lavadoraId = await seedMaquina({ nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await ponerMarca(lavadoraId, 'LG');

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(RESPALDO_MEDIANA);
  });

  it('el edredón ya no tiene tiempo propio: usa el de su máquina', async () => {
    const lg = await seedMarca('LG');
    await tiempoDe(lg, 'lavadora', 'jumbo', 45);
    const lavadoraId = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    await ponerMarca(lavadoraId, 'LG');

    const clienteId = await seedCliente();
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO',
      tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE',
      cliente_id: clienteId,
      cargas: [{ lavadora_tipo: 'jumbo', tamano: 'jumbo', tipo_prenda: 'EDREDON' }],
    });
    expect(creada.status).toBe(201);
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId }).expect(200);

    // 45 (la marca), no un tiempo de edredón aparte.
    expect(await cicloDe(lavadoraId)).toBe(45);
  });
});

describe('GET/PUT /api/etiquetas/tiempos-marca', () => {
  it('lista las combinaciones que existen y guarda una nueva', async () => {
    const lg = await seedMarca('LG');
    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await ponerMarca(lavadoraId, 'LG');

    // La combinación aparece aunque todavía no tenga tiempo configurado.
    const lista = await request(app).get('/api/etiquetas/tiempos-marca').set(auth(admin.token));
    expect(lista.status).toBe(200);
    expect(lista.body).toContainEqual(
      expect.objectContaining({ marca: 'LG', tipo: 'lavadora', tamano: 'mediana', minutos: null })
    );

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ marca_id: lg, tipo: 'lavadora', tamano: 'mediana', minutos: 45 }).expect(200);

    const despues = await request(app).get('/api/etiquetas/tiempos-marca').set(auth(admin.token));
    expect(despues.body).toContainEqual(
      expect.objectContaining({ marca: 'LG', tipo: 'lavadora', tamano: 'mediana', minutos: 45 })
    );
  });

  it('vaciar el tiempo lo borra y la máquina vuelve al respaldo por tamaño', async () => {
    const lg = await seedMarca('LG');
    await tiempoDe(lg, 'lavadora', 'mediana', 45);
    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    await ponerMarca(lavadoraId, 'LG');

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ marca_id: lg, tipo: 'lavadora', tamano: 'mediana', minutos: '' }).expect(200);

    await arrancar(lavadoraId);
    expect(await cicloDe(lavadoraId)).toBe(RESPALDO_MEDIANA);
  });

  it('un operador no puede cambiar los tiempos', async () => {
    const lg = await seedMarca('LG');
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Opé' });

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(operador.token))
      .send({ marca_id: lg, tipo: 'lavadora', tamano: 'mediana', minutos: 45 }).expect(403);
  });

  it('rechaza minutos no positivos', async () => {
    const lg = await seedMarca('LG');
    const res = await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ marca_id: lg, tipo: 'lavadora', tamano: 'mediana', minutos: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mayor que cero/i);
  });
});
