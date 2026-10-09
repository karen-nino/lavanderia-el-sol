// "Otro ciclo" de la secadora de monedas que pregunta su programa (la Sec49,
// 2026-10-08): con la carga corriendo se le suma otro programa sin pasarse
// del tope. Tope 30: con 20 elegidos solo cabe 10; con 10, caben 10 y 20.
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
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    cargas: [{ secadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot: 'secadora', maquina_id: secId }).expect(200);
  await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: secId, minutos }).expect(200);
  return creada.body.id;
}

const opciones = async (id) => {
  const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
  return res.body.find(x => x.id === id).opciones_mas_tiempo;
};

const sumar = (id, minutos) =>
  request(app).patch(`/api/maquinas/${id}/mas-tiempo`).set(auth(admin.token)).send({ minutos });

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
  it('suma al programa sin reiniciar el cronómetro', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    const antes = (await pool.query('SELECT en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];

    await sumar(id, 10).expect(200);

    expect(await elegido(id)).toBe(30);
    const despues = (await pool.query('SELECT en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];
    expect(despues.en_uso_desde).toEqual(antes.en_uso_desde);
    expect(await opciones(id)).toEqual([]);
  });

  it('no deja pasarse del tope', async () => {
    const id = await sec49();
    await arrancada(id, 20);
    const res = await sumar(id, 20);
    expect(res.status).toBe(400);
    expect(await elegido(id)).toBe(20);
  });

  it('con 10 elegidos se pueden sumar 10 y luego otros 10', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    await sumar(id, 10).expect(200);
    expect(await opciones(id)).toEqual([10]);
    await sumar(id, 10).expect(200);
    expect(await elegido(id)).toBe(30);
  });

  it('rechaza minutos que no son uno de sus programas', async () => {
    const id = await sec49();
    await arrancada(id, 10);
    expect((await sumar(id, 5)).status).toBe(400);
    expect((await sumar(id, 'x')).status).toBe(400);
  });
});
