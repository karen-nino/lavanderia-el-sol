// Modelos de máquina (migs. 117 y 118).
//
// Los modelos cuelgan de una marca, dicen qué máquina son (tipo y tamaño) y
// pueden traer su propio tiempo de ciclo, que se escribe desde los bloques de
// tiempos de Ajustes y no desde el catálogo.
// Lo que se fija aquí es la cadena de resolución completa —modelo →
// marca+tamaño (mig. 107) → tamaño (Ajustes)— porque es la que decide cuánto
// corre el temporizador y, con el corte automático, cuándo se le va la luz a
// una lavadora a media carga.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth,
} from '../helpers.js';

let admin;

const RESPALDO_MEDIANA = 30;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({
    tiempo_carga_mediana: RESPALDO_MEDIANA,
    tiempo_carga_jumbo: 99,
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

const tiempoDeMarca = (marcaId, tipo, tamano, minutos) =>
  pool.query(
    `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos) VALUES ($1, $2, $3, $4)
     ON CONFLICT (marca_id, tipo, tamano) DO UPDATE SET minutos = EXCLUDED.minutos`,
    [marcaId, tipo, tamano, minutos]
  );

const crearModelo = (token, body) =>
  request(app).post('/api/etiquetas/modelos-maquina').set(auth(token))
    .send({ tipo: 'lavadora', tamano: 'mediana', ...body });

const cicloDe = async (maquinaId) => {
  const { rows } = await pool.query('SELECT ciclo_minutos FROM maquinas WHERE id = $1', [maquinaId]);
  return rows[0].ciclo_minutos;
};

// Nota de autoservicio pagada, con la lavadora asignada y arrancada: es el
// camino que sella el ciclo de la máquina.
async function arrancar(lavadoraId) {
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO',
    tipo_prenda: 'ROPA',
    estado_pago: 'PAGADO',
    forma_pago: 'EFECTIVO',
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
  await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: lavadoraId }).expect(200);
  return creada.body.id;
}

describe('CRUD de modelos', () => {
  it('el admin crea un modelo de una marca', async () => {
    const lg = await seedMarca('Whirlpool');
    const res = await crearModelo(admin.token, {
      marca_id: lg, nombre: 'WM3400', tipo: 'lavadora', tamano: 'jumbo', minutos: 45,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      marca_id: lg, nombre: 'WM3400', tipo: 'lavadora', tamano: 'jumbo', minutos: 45, activo: true,
    });
  });

  it('el tipo y el tamaño son obligatorios y cerrados', async () => {
    const lg = await seedMarca('Whirlpool');
    const sinTipo = await request(app).post('/api/etiquetas/modelos-maquina').set(auth(admin.token))
      .send({ marca_id: lg, nombre: 'WM3400', tamano: 'mediana' });
    expect(sinTipo.status).toBe(400);

    const tipoRaro = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', tipo: 'planchadora' });
    expect(tipoRaro.status).toBe(400);

    const tamanoRaro = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', tamano: 'gigante' });
    expect(tamanoRaro.status).toBe(400);
  });

  it('el modelo puede ir sin minutos: hereda los de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: '' });
    expect(res.status).toBe(201);
    expect(res.body.minutos).toBeNull();
  });

  it('un empleado no puede crear modelos', async () => {
    const lg = await seedMarca('Whirlpool');
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Opé' });
    await crearModelo(operador.token, { marca_id: lg, nombre: 'WM3400' }).expect(403);
  });

  it('el mismo nombre repetido en la misma marca → 409', async () => {
    const lg = await seedMarca('Whirlpool');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' });
    expect(res.status).toBe(409);
  });

  it('dos marcas sí pueden tener un modelo con el mismo nombre', async () => {
    const lg = await seedMarca('Whirlpool');
    const samsung = await seedMarca('Samsung');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'Básica' }).expect(201);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'Básica' }).expect(201);
  });

  it('rechaza minutos que no son un entero positivo', async () => {
    const lg = await seedMarca('Whirlpool');
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mayor que cero/i);
  });

  it('marca inexistente → 404', async () => {
    const res = await crearModelo(admin.token, { marca_id: 999999, nombre: 'WM3400' });
    expect(res.status).toBe(404);
  });

  it('lista solo los modelos de la marca pedida, con el nombre de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    const samsung = await seedMarca('Samsung');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'WA50' }).expect(201);

    const todos = await request(app).get('/api/etiquetas/modelos-maquina').set(auth(admin.token));
    expect(todos.status).toBe(200);
    expect(todos.body).toHaveLength(2);

    const soloLg = await request(app).get(`/api/etiquetas/modelos-maquina?marca_id=${lg}`)
      .set(auth(admin.token));
    expect(soloLg.body).toHaveLength(1);
    expect(soloLg.body[0]).toMatchObject({ nombre: 'WM3400', marca: 'Whirlpool' });
  });

  it('renombra, desactiva y quita el tiempo propio del modelo', async () => {
    const lg = await seedMarca('Whirlpool');
    const { body } = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 45 });

    const res = await request(app).put(`/api/etiquetas/modelos-maquina/${body.id}`)
      .set(auth(admin.token)).send({ nombre: 'WM3400CW', activo: false, minutos: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nombre: 'WM3400CW', activo: false, minutos: null });
  });

  it('corrige el tipo y el tamaño de un modelo mal capturado', async () => {
    const lg = await seedMarca('Whirlpool');
    const { body } = await crearModelo(admin.token, { marca_id: lg, nombre: 'DLE7300' });

    const res = await request(app).put(`/api/etiquetas/modelos-maquina/${body.id}`)
      .set(auth(admin.token)).send({ tipo: 'secadora', tamano: 'jumbo' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tipo: 'secadora', tamano: 'jumbo' });

    const malo = await request(app).put(`/api/etiquetas/modelos-maquina/${body.id}`)
      .set(auth(admin.token)).send({ tamano: 'gigante' });
    expect(malo.status).toBe(400);
  });

  it('reordena los modelos de una marca sin tocar los de otra', async () => {
    const lg = await seedMarca('Whirlpool');
    const samsung = await seedMarca('Samsung');
    const a = (await crearModelo(admin.token, { marca_id: lg, nombre: 'A' })).body;
    const b = (await crearModelo(admin.token, { marca_id: lg, nombre: 'B' })).body;
    const otro = (await crearModelo(admin.token, { marca_id: samsung, nombre: 'Z' })).body;

    const res = await request(app).patch('/api/etiquetas/modelos-maquina/reordenar')
      .set(auth(admin.token)).send({ marca_id: lg, ids: [b.id, a.id] });
    expect(res.status).toBe(200);
    expect(res.body.map((m) => m.nombre)).toEqual(['B', 'A']);

    const { rows } = await pool.query('SELECT orden FROM modelos_maquina WHERE id = $1', [otro.id]);
    expect(rows[0].orden).toBe(otro.orden);
  });

  it('desactivar una marca no borra sus modelos', async () => {
    const lg = await seedMarca('Whirlpool');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);

    await request(app).put(`/api/etiquetas/marcas-maquina/${lg}`).set(auth(admin.token))
      .send({ activo: false }).expect(200);

    const res = await request(app).get(`/api/etiquetas/modelos-maquina?marca_id=${lg}`)
      .set(auth(admin.token));
    expect(res.body).toHaveLength(1);
  });
});

describe('sellado del ciclo — manda el modelo', () => {
  it('el tiempo del modelo le gana al de la marca', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM3400',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(15);
  });

  it('un modelo sin tiempo propio cae al de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM3400',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('una máquina sin modelo sigue con el tiempo de su marca: hoy son todas', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('un modelo de OTRA marca no se le pega a la máquina', async () => {
    const lg = await seedMarca('Whirlpool');
    const samsung = await seedMarca('Samsung');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM3400',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('sin marca ni modelo manda el respaldo por tamaño de Ajustes', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'L5', tipo: 'lavadora_mediana', tamano: 'mediana' });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(RESPALDO_MEDIANA);
  });
});

describe('GET/PUT /api/etiquetas/tiempos-marca — el renglón dice marca y modelo', () => {
  it('el modelo aparece como renglón propio aunque ninguna máquina lo use', async () => {
    const lg = await seedMarca('Whirlpool');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM22WV26SR' }).expect(201);

    const { body } = await request(app).get('/api/etiquetas/tiempos-marca').set(auth(admin.token));
    expect(body).toContainEqual(expect.objectContaining({
      marca: 'Whirlpool', modelo: 'WM22WV26SR', tipo: 'lavadora', tamano: 'mediana', minutos: null,
    }));
  });

  it('el modelo cae en el bloque de SU tipo y tamaño, no en el de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'DLE7300', tipo: 'secadora', tamano: 'jumbo' })
      .expect(201);

    const { body } = await request(app).get('/api/etiquetas/tiempos-marca').set(auth(admin.token));
    const fila = body.find(t => t.modelo === 'DLE7300');
    expect(fila).toMatchObject({ tipo: 'secadora', tamano: 'jumbo' });
  });

  it('el tiempo se guarda por modelo_id y manda sobre el de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    const modelo = (await crearModelo(admin.token, { marca_id: lg, nombre: 'WM22WV26SR' })).body;

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: modelo.id, minutos: 15 }).expect(200);

    const lavadoraId = await seedMaquina({
      nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM22WV26SR',
    });
    await arrancar(lavadoraId);
    expect(await cicloDe(lavadoraId)).toBe(15);
  });

  it('vaciar el tiempo del modelo lo devuelve al de su marca', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    const modelo = (await crearModelo(admin.token, { marca_id: lg, nombre: 'WM22WV26SR', minutos: 15 })).body;

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: modelo.id, minutos: '' }).expect(200);

    const lavadoraId = await seedMaquina({
      nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool', modelo: 'WM22WV26SR',
    });
    await arrancar(lavadoraId);
    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('la marca suelta ya no se lista, aunque tenga máquinas y tiempo propio', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await seedMaquina({ nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool' });

    const { body } = await request(app).get('/api/etiquetas/tiempos-marca').set(auth(admin.token));
    expect(body.every(t => t.modelo_id != null)).toBe(true);
  });

  it('el tiempo por marca deja de listarse pero sigue aplicándose a las máquinas sin modelo', async () => {
    const lg = await seedMarca('Whirlpool');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    const lavadoraId = await seedMaquina({
      nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'Whirlpool',
    });

    await arrancar(lavadoraId);

    // 45 (el de la marca), no los 30 del respaldo por tamaño: quitarlo de la
    // pantalla no puede cambiarle el ciclo a una máquina en operación.
    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('un modelo inexistente → 404 y un minutos inválido → 400', async () => {
    const lg = await seedMarca('Whirlpool');
    const modelo = (await crearModelo(admin.token, { marca_id: lg, nombre: 'WM22WV26SR' })).body;

    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: 999999, minutos: 15 }).expect(404);
    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: modelo.id, minutos: 0 }).expect(400);
  });
});

// Tres tiempos por modelo y el interruptor que los pregunta (mig. 120).
// Desde la mig. 146 el campo grande (`minutos`) del modelo que pregunta es su
// TOPE y los tres programas a elegir van en minutos_2..4.
describe('modelo con tres tiempos', () => {
  const interruptorAntes = process.env.MAQUINAS_CRONOMETRO;
  afterEach(() => {
    if (interruptorAntes === undefined) delete process.env.MAQUINAS_CRONOMETRO;
    else process.env.MAQUINAS_CRONOMETRO = interruptorAntes;
  });

  const elegidoDe = async (id) =>
    (await pool.query('SELECT ciclo_elegido_minutos FROM maquinas WHERE id = $1', [id])).rows[0].ciclo_elegido_minutos;

  // Una secadora con su modelo de tres programas, lista para arrancar dentro
  // de una nota que ya tiene su lavadora corriendo.
  async function conSecadoraDeTresTiempos({ pregunta = true, tope = 75 } = {}) {
    const sq = await seedMarca('Speed Queen');
    // Que el modelo tenga varios tiempos se declara en su catálogo; los
    // minutos se escriben desde el bloque de tiempos.
    const modelo = (await crearModelo(admin.token, {
      marca_id: sq, nombre: 'Sec49', tipo: 'secadora', tamano: 'jumbo', minutos: 30,
      pregunta_tiempo: pregunta,
    })).body;
    expect(modelo.pregunta_tiempo).toBe(pregunta);
    await request(app).put('/api/etiquetas/tiempos-marca').set(auth(admin.token))
      .send({ modelo_id: modelo.id, minutos: tope, minutos_2: 30, minutos_3: 45, minutos_4: 60 })
      .expect(200);

    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const secadoraId = await seedMaquina({
      nombre: 'S1', tipo: 'secadora', tamano: 'jumbo', marca: 'Speed Queen', modelo: 'Sec49',
    });

    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana', secadora_tipo: 'jumbo' }],
    });
    expect(creada.status).toBe(201);
    const cargaId = creada.body.cargas[0].id;
    for (const [slot, maquina_id] of [['lavadora', lavadoraId], ['secadora', secadoraId]]) {
      await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
        .send({ carga_id: cargaId, slot, maquina_id }).expect(200);
    }
    return { notaId: creada.body.id, secadoraId, modelo };
  }

  it('el interruptor se enciende y se apaga desde el catálogo del modelo', async () => {
    const lg = await seedMarca('Whirlpool');
    const { body } = await crearModelo(admin.token, { marca_id: lg, nombre: 'DLE7300', tipo: 'secadora' });
    expect(body.pregunta_tiempo).toBe(false);

    const res = await request(app).put(`/api/etiquetas/modelos-maquina/${body.id}`)
      .set(auth(admin.token)).send({ pregunta_tiempo: true });
    expect(res.status).toBe(200);
    expect(res.body.pregunta_tiempo).toBe(true);
  });

  it('con cronómetro el programa elegido se guarda aparte y el tope es el campo grande', async () => {
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos();

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId, minutos: 30 }).expect(200);

    expect(await cicloDe(secadoraId)).toBe(75);
    expect(await elegidoDe(secadoraId)).toBe(30);
  });

  it('con temporizador el programa elegido es lo que dura', async () => {
    process.env.MAQUINAS_CRONOMETRO = 'off';
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos();

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId, minutos: 45 }).expect(200);

    expect(await cicloDe(secadoraId)).toBe(45);
  });

  it('sin elegir nada manda el tope y no queda programa', async () => {
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos();

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId }).expect(200);

    expect(await cicloDe(secadoraId)).toBe(75);
    expect(await elegidoDe(secadoraId)).toBeNull();
  });

  it('sin tope capturado manda el programa más largo', async () => {
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos({ tope: null });

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId, minutos: 30 }).expect(200);

    expect(await cicloDe(secadoraId)).toBe(60);
  });

  it('con el interruptor apagado no se acepta elegir y manda el tope', async () => {
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos({ pregunta: false });

    const res = await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId, minutos: 30 });
    expect(res.status).toBe(400);

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId }).expect(200);
    expect(await cicloDe(secadoraId)).toBe(75);
  });

  it('un tiempo que el modelo no ofrece se rechaza: es lo que corta la corriente', async () => {
    const { notaId, secadoraId } = await conSecadoraDeTresTiempos();

    const res = await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: secadoraId, minutos: 120 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no ofrece ese tiempo/i);
  });

  it('la máquina lleva sus tiempos y el interruptor para que la pantalla sepa si preguntar', async () => {
    const { secadoraId } = await conSecadoraDeTresTiempos();

    const { body } = await request(app).get('/api/maquinas').set(auth(admin.token));
    const secadora = body.find(m => m.id === secadoraId);
    expect(secadora.modelo_tiempos).toEqual({ pregunta: true, minutos: [30, 45, 60] });
    expect([secadora.cronometro, secadora.con_iniciar]).toEqual([true, true]);
  });
});
