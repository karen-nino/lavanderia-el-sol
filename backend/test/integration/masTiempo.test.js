// "Otro ciclo" de la secadora de monedas que pregunta su programa (la Sec49,
// 2026-10-08): al terminar su programa se le suma otro sin pasarse del tope
// en minutos METIDOS (mig. 148). Tope 30: con 20 metidos solo cabe 10; con
// 10, caben 10 y 20. Si el empleado tarda, el fin nuevo cuenta desde ahora.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth,
} from '../helpers.js';
import { cancelarCortesProgramados } from '../../services/sincronizarSonoff.js';

let admin;

beforeEach(async () => {
  cancelarCortesProgramados();
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});

async function sec49({ porMoneda = 10 } = {}) {
  await seedMarca({ nombre: 'Speed Queen', tipo: 'secadora', tamano: 'mediana' });
  await pool.query(
    `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, minutos_2, minutos_3, minutos_4,
                                  pregunta_tiempo, minutos_por_moneda)
     SELECT id, 'Sec49', 'secadora', 'mediana', 30, 10, 20, 30, TRUE, $1
       FROM marcas_maquina WHERE nombre = 'Speed Queen'`,
    [porMoneda]
  );
  return seedMaquina({ nombre: 'S4', tipo: 'secadora', tamano: 'mediana', marca: 'Speed Queen', modelo: 'Sec49' });
}

// Nota de autoservicio con la secadora arrancada con el programa `minutos`.
async function arrancada(secId, minutos) {
  return (await arrancadaConCarga(secId, minutos)).notaId;
}

async function arrancadaConCarga(secId, minutos) {
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    cargas: [{ secadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot: 'secadora', maquina_id: secId }).expect(200);
  await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: secId, minutos }).expect(200);
  return { notaId: creada.body.id, cargaId: creada.body.cargas[0].id };
}

const opciones = async (id) => {
  const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
  return res.body.find(x => x.id === id).opciones_mas_tiempo;
};

const sumar = (id, minutos) =>
  request(app).patch(`/api/maquinas/${id}/mas-tiempo`).set(auth(admin.token)).send({ minutos });

// Atrasa el arranque `min` minutos: como si llevara ese rato secando.
const llevaSecando = (id, min) =>
  pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - make_interval(mins => $2) WHERE id = $1`, [id, min]);

const pagados = async (id) =>
  (await pool.query('SELECT minutos_pagados FROM maquinas WHERE id = $1', [id])).rows[0].minutos_pagados;

const elegido = async (id) =>
  (await pool.query('SELECT ciclo_elegido_minutos FROM maquinas WHERE id = $1', [id])).rows[0].ciclo_elegido_minutos;

describe('opciones de Otro ciclo', () => {
  it('con 20 elegidos y tope 30 solo ofrece 10', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    expect(await opciones(id)).toEqual([10]);
  });

  it('con 10 elegidos ofrece 10 y 20', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    expect(await opciones(id)).toEqual([10, 20]);
  });

  it('con 30 elegidos ya no ofrece nada', async () => {
    const id = await sec49();
    await arrancada(id, 30);
    expect(await opciones(id)).toEqual([]);
  });

  it('un modelo que pregunta pero no es de monedas no lo ofrece', async () => {
    const id = await sec49({ porMoneda: null });
    await arrancada(id, 10);
    expect(await opciones(id)).toEqual([]);
  });

  it('una secadora libre no lo ofrece', async () => {
    const id = await sec49();
    expect(await opciones(id)).toEqual([]);
  });
});

describe('PATCH /maquinas/:id/mas-tiempo', () => {
  it('no deja sumar mientras sigue su programa', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    await llevaSecando(id, 5);
    const res = await sumar(id, 10);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cuando termine/);
    expect(await elegido(id)).toBe(20);
  });

  it('al terminar el programa suma sin reiniciar el cronómetro', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    await llevaSecando(id, 20);
    const antes = (await pool.query('SELECT en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];

    await sumar(id, 10).expect(200);

    expect(await pagados(id)).toBe(30);
    expect(await elegido(id)).toBe(30);
    const despues = (await pool.query('SELECT en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];
    expect(despues.en_uso_desde).toEqual(antes.en_uso_desde);
    expect(await opciones(id)).toEqual([]);
  });

  it('si tarda 5 min en decidirse, el fin nuevo cuenta desde ahora y el tope desde lo metido', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await llevaSecando(id, 15);          // se acabó al 10, decide al 15

    await sumar(id, 20).expect(200);

    expect(await pagados(id)).toBe(30);  // 10 + 20 metidos: llegó al tope
    expect(await elegido(id)).toBe(35);  // seca hasta el minuto 35
    expect(await opciones(id)).toEqual([]);
  });

  it('no deja pasarse del tope', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    await llevaSecando(id, 20);
    const res = await sumar(id, 20);
    expect(res.status).toBe(400);
    expect(await elegido(id)).toBe(20);
  });

  it('con 10 metidos se pueden sumar 10 y, al terminar esos, otros 10', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await llevaSecando(id, 10);
    await sumar(id, 10).expect(200);
    expect(await opciones(id)).toEqual([10]);
    await llevaSecando(id, 20);
    await sumar(id, 10).expect(200);
    expect(await pagados(id)).toBe(30);
  });

  it('rechaza minutos que no son uno de sus programas', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await llevaSecando(id, 10);
    expect((await sumar(id, 5)).status).toBe(400);
    expect((await sumar(id, 'x')).status).toBe(400);
  });

  it('un arranque nuevo empieza sin minutos sumados', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await llevaSecando(id, 10);
    await sumar(id, 10).expect(200);
    // Se libera tal cual (finalizar es otro flujo) y la arranca otra nota.
    await pool.query(`UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = $1`, [id]);
    await arrancada(id, 20);
    expect(await pagados(id)).toBeNull();
    expect(await opciones(id)).toEqual([10]);
  });
});

describe('el reloj de la que recibió Otro ciclo (Ventas, Información de uso)', () => {
  it('si secó más allá del tope, al finalizar cuenta hasta el fin real y no marca tope', async () => {
    const id = await sec49();
    const { notaId, cargaId } = await arrancadaConCarga(id, 10);
    await llevaSecando(id, 15);
    await sumar(id, 20).expect(200);       // seca hasta el 35
    // Mover también el arranque de la pasada, como si hubiera pasado el tiempo.
    await llevaSecando(id, 34);

    await request(app).patch(`/api/notas/${notaId}/terminar-secado`).set(auth(admin.token))
      .send({ secadora_id: id }).expect(200);

    const { rows } = await pool.query(
      `SELECT llego_tope, EXTRACT(EPOCH FROM finalizada_at - encendida_at) AS seg
         FROM nota_carga_maquinas WHERE carga_id = $1 AND slot = 'secadora'`, [cargaId]);
    expect(rows[0].llego_tope).toBe(false);
    expect(Number(rows[0].seg)).toBeGreaterThan(33 * 60);  // no se cortó en 30
  });

  it('sin Otro ciclo el reloj se sigue parando en el tope', async () => {
    const id = await sec49();
    const { notaId, cargaId } = await arrancadaConCarga(id, 10);
    await llevaSecando(id, 34);
    await request(app).patch(`/api/notas/${notaId}/terminar-secado`).set(auth(admin.token))
      .send({ secadora_id: id }).expect(200);
    const { rows } = await pool.query(
      `SELECT llego_tope, EXTRACT(EPOCH FROM finalizada_at - encendida_at) AS seg
         FROM nota_carga_maquinas WHERE carga_id = $1 AND slot = 'secadora'`, [cargaId]);
    expect(rows[0].llego_tope).toBe(true);
    expect(Math.round(Number(rows[0].seg))).toBe(30 * 60);
  });
});
