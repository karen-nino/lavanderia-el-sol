// Modelos de máquina (mig. 117).
//
// Los modelos cuelgan de una marca y pueden traer su propio tiempo de ciclo.
// Lo que se fija aquí es la cadena de resolución completa —modelo →
// marca+tamaño (mig. 107) → tamaño (Ajustes)— porque es la que decide cuánto
// corre el temporizador y, con el corte automático, cuándo se le va la luz a
// una lavadora a media carga.
import { describe, it, expect, beforeEach } from 'vitest';
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
  request(app).post('/api/etiquetas/modelos-maquina').set(auth(token)).send(body);

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
    const lg = await seedMarca('LG');
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 45 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ marca_id: lg, nombre: 'WM3400', minutos: 45, activo: true });
  });

  it('el modelo puede ir sin minutos: hereda los de su marca', async () => {
    const lg = await seedMarca('LG');
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: '' });
    expect(res.status).toBe(201);
    expect(res.body.minutos).toBeNull();
  });

  it('un empleado no puede crear modelos', async () => {
    const lg = await seedMarca('LG');
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Opé' });
    await crearModelo(operador.token, { marca_id: lg, nombre: 'WM3400' }).expect(403);
  });

  it('el mismo nombre repetido en la misma marca → 409', async () => {
    const lg = await seedMarca('LG');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' });
    expect(res.status).toBe(409);
  });

  it('dos marcas sí pueden tener un modelo con el mismo nombre', async () => {
    const lg = await seedMarca('LG');
    const samsung = await seedMarca('Samsung');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'Básica' }).expect(201);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'Básica' }).expect(201);
  });

  it('rechaza minutos que no son un entero positivo', async () => {
    const lg = await seedMarca('LG');
    const res = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mayor que cero/i);
  });

  it('marca inexistente → 404', async () => {
    const res = await crearModelo(admin.token, { marca_id: 999999, nombre: 'WM3400' });
    expect(res.status).toBe(404);
  });

  it('lista solo los modelos de la marca pedida, con el nombre de su marca', async () => {
    const lg = await seedMarca('LG');
    const samsung = await seedMarca('Samsung');
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'WA50' }).expect(201);

    const todos = await request(app).get('/api/etiquetas/modelos-maquina').set(auth(admin.token));
    expect(todos.status).toBe(200);
    expect(todos.body).toHaveLength(2);

    const soloLg = await request(app).get(`/api/etiquetas/modelos-maquina?marca_id=${lg}`)
      .set(auth(admin.token));
    expect(soloLg.body).toHaveLength(1);
    expect(soloLg.body[0]).toMatchObject({ nombre: 'WM3400', marca: 'LG' });
  });

  it('renombra, desactiva y quita el tiempo propio del modelo', async () => {
    const lg = await seedMarca('LG');
    const { body } = await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 45 });

    const res = await request(app).put(`/api/etiquetas/modelos-maquina/${body.id}`)
      .set(auth(admin.token)).send({ nombre: 'WM3400CW', activo: false, minutos: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nombre: 'WM3400CW', activo: false, minutos: null });
  });

  it('reordena los modelos de una marca sin tocar los de otra', async () => {
    const lg = await seedMarca('LG');
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
    const lg = await seedMarca('LG');
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
    const lg = await seedMarca('LG');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG', modelo: 'WM3400',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(15);
  });

  it('un modelo sin tiempo propio cae al de su marca', async () => {
    const lg = await seedMarca('LG');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400' }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG', modelo: 'WM3400',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('una máquina sin modelo sigue con el tiempo de su marca: hoy son todas', async () => {
    const lg = await seedMarca('LG');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: lg, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG',
    });

    await arrancar(lavadoraId);

    expect(await cicloDe(lavadoraId)).toBe(45);
  });

  it('un modelo de OTRA marca no se le pega a la máquina', async () => {
    const lg = await seedMarca('LG');
    const samsung = await seedMarca('Samsung');
    await tiempoDeMarca(lg, 'lavadora', 'mediana', 45);
    await crearModelo(admin.token, { marca_id: samsung, nombre: 'WM3400', minutos: 15 }).expect(201);
    const lavadoraId = await seedMaquina({
      nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG', modelo: 'WM3400',
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
