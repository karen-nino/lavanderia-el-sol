// "Otro ciclo" de la secadora de fichas que pregunta su programa (Sec49): al
// terminar se le suma otro sin pasar el tope en minutos metidos. Tope 30: con 20
// metidos solo cabe 10; con 10, caben 10 y 20. Si el empleado tarda, el fin
// nuevo cuenta desde ahora.
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

async function sec49({ porFicha = 10 } = {}) {
  await seedMarca({ nombre: 'Speed Queen', tipo: 'secadora', tamano: 'mediana' });
  await pool.query(
    `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, minutos_2, minutos_3, minutos_4,
                                  pregunta_tiempo, minutos_por_ficha)
     SELECT id, 'Sec49', 'secadora', 'mediana', 30, 10, 20, 30, TRUE, $1
       FROM marcas_maquina WHERE nombre = 'Speed Queen'`,
    [porFicha]
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

  it('un modelo que pregunta pero no es de fichas no lo ofrece', async () => {
    const id = await sec49({ porFicha: null });
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

// "Otra ficha" (v1.114.0): desde que corre, cada ficha suma sus minutos al fin
// que tenga por delante, sin tope.
const otraFicha = (id) => request(app).patch(`/api/maquinas/${id}/otra-ficha`).set(auth(admin.token)).send({});

const finEnMinutos = async (id) => {
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (en_uso_desde + make_interval(mins => ciclo_elegido_minutos) - NOW())) / 60 AS min
       FROM maquinas WHERE id = $1`, [id]);
  return Number(rows[0].min);
};

describe('PATCH /maquinas/:id/otra-ficha', () => {
  it('a media corrida: con 15 min por delante quedan 25', async () => {
    const id = await sec49();
    await arrancada(id, 30);
    await llevaSecando(id, 15);
    const res = await otraFicha(id);
    expect(res.status).toBe(200);
    expect(res.body.minutos_restantes).toBe(25);
    expect(Math.round(await finEnMinutos(id))).toBe(25);
  });

  it('sin tope: suma aunque pase del tope del modelo', async () => {
    const id = await sec49();
    await arrancada(id, 30); // tope 30
    expect((await otraFicha(id)).status).toBe(200);
    expect((await otraFicha(id)).status).toBe(200);
    expect(await elegido(id)).toBe(50);
    expect(await pagados(id)).toBe(50);
  });

  it('el tope crece una ficha: 20 elegidos, tope 30 y +10 → tope 40', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    const tope = async () => (await pool.query('SELECT ciclo_minutos FROM maquinas WHERE id = $1', [id])).rows[0].ciclo_minutos;
    expect(await tope()).toBe(30);
    await otraFicha(id).expect(200);
    expect(await elegido(id)).toBe(30);
    expect(await tope()).toBe(40);
  });

  it('ya acabado el programa: cuenta desde ahora', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await llevaSecando(id, 14);
    await otraFicha(id).expect(200);
    expect(Math.round(await finEnMinutos(id))).toBe(10);
  });

  it('una secadora que no es de fichas no la admite', async () => {
    const id = await sec49({ porFicha: null });
    await arrancada(id, 10);
    expect((await otraFicha(id)).status).toBe(400);
  });

  it('una secadora libre no la admite', async () => {
    const id = await sec49();
    expect((await otraFicha(id)).status).toBe(400);
  });
});

// Costo de cada ficha (mig. 164): se cobra en Autoservicio, no en Por Encargo.
describe('otra ficha — costo', () => {
  const conCosto = async (id, precio) => pool.query(
    "UPDATE modelos_maquina SET precio_por_ficha = $1 WHERE nombre = 'Sec49'", [precio]);
  const carga = async (cargaId) =>
    (await pool.query('SELECT fichas_extra, precio_fichas_extra FROM nota_cargas WHERE id = $1', [cargaId])).rows[0];
  const nota = async (notaId) =>
    (await pool.query('SELECT precio_total, estado_pago FROM notas WHERE id = $1', [notaId])).rows[0];

  it('en Autoservicio suma su costo a la nota (y la deja por cobrar)', async () => {
    const id = await sec49();
    await conCosto(id, 12.5);
    const { notaId, cargaId } = await arrancadaConCarga(id, 30);
    const antes = Number((await nota(notaId)).precio_total);

    const res = await otraFicha(id);
    expect(res.status).toBe(200);
    expect(res.body.precio).toBe(12.5);
    expect(await carga(cargaId)).toEqual({ fichas_extra: 1, precio_fichas_extra: '12.50' });
    const despues = await nota(notaId);
    expect(Number(despues.precio_total)).toBe(antes + 12.5);
    expect(despues.estado_pago).toBe('PENDIENTE');
  });

  it('en Por Encargo la cuenta pero no la cobra', async () => {
    const id = await sec49();
    await conCosto(id, 10);
    const { notaId, cargaId } = await arrancadaConCarga(id, 30);
    await pool.query("UPDATE notas SET tipo_servicio = 'POR_ENCARGO' WHERE id = $1", [notaId]);
    const antes = Number((await nota(notaId)).precio_total);

    await otraFicha(id).expect(200);
    expect(await carga(cargaId)).toEqual({ fichas_extra: 1, precio_fichas_extra: '0.00' });
    expect(Number((await nota(notaId)).precio_total)).toBe(antes);
  });

  it('se guarda desde Ajustes', async () => {
    await sec49();
    const { rows } = await pool.query("SELECT id FROM modelos_maquina WHERE nombre = 'Sec49'");
    const res = await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: rows[0].id, precio_por_ficha: 15 });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_por_ficha)).toBe(15);
    const mal = await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: rows[0].id, precio_por_ficha: -3 });
    expect(mal.status).toBe(400);
  });
});

describe('otra ficha — a qué nota se cobra', () => {
  it('a la que la arrancó, no a otra más nueva que solo la tiene asignada', async () => {
    const id = await sec49();
    await pool.query("UPDATE modelos_maquina SET precio_por_ficha = 10 WHERE nombre = 'Sec49'");
    const nueva = async () => (await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ secadora_tipo: 'mediana' }],
    })).body;
    const asignar = (n) => request(app).patch(`/api/notas/${n.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: n.cargas[0].id, slot: 'secadora', maquina_id: id }).expect(200);
    // Las dos la tienen asignada (asignar no aparta); la más vieja la arranca.
    const vieja = await nueva();
    const otra = await nueva();
    await asignar(vieja);
    await asignar(otra);
    await request(app).patch(`/api/notas/${vieja.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: id, minutos: 30 }).expect(200);

    expect((await otraFicha(id)).status).toBe(200);
    const fichas = async (n) =>
      (await pool.query('SELECT fichas_extra FROM nota_cargas WHERE id = $1', [n.cargas[0].id])).rows[0].fichas_extra;
    expect(await fichas(vieja)).toBe(1);
    expect(await fichas(otra)).toBe(0);
    // Pedida desde la otra nota: no se le cobra a nadie.
    const mal = await request(app).patch(`/api/maquinas/${id}/otra-ficha`).set(auth(admin.token)).send({ nota_id: otra.id });
    expect(mal.status).toBe(409);
    expect(await fichas(vieja)).toBe(1);
  });
});
