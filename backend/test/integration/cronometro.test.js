// Máquinas con CRONÓMETRO: todas, lavadoras y secadoras (2026-10-02).
//
// Se probó primero con las lavadoras LG y Samsung (mig. 137) y se extendió a
// todas. Al encenderlas empieza a contar hacia arriba —no hay paso de
// "Iniciar"—, la carga corre un solo ciclo y termina cuando alguien la
// finaliza. Los minutos de su modelo, su marca o su tamaño son su TOPE: si
// nadie la finaliza, el corte le quita la luz y se avisa en la campana.
//
// La excepción es el modelo que PREGUNTA su tiempo al iniciar (la Sec49): ese
// conserva su temporizador. Y `MAQUINAS_CRONOMETRO=off` devuelve todas al
// temporizador.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth,
} from '../helpers.js';
import { sincronizarSonoff, cancelarCortesProgramados } from '../../services/sincronizarSonoff.js';

let admin;

beforeEach(async () => {
  cancelarCortesProgramados();
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});

// Algunas pruebas apagan el interruptor; se restaura siempre.
const interruptorAntes = process.env.MAQUINAS_CRONOMETRO;
afterEach(() => {
  if (interruptorAntes === undefined) delete process.env.MAQUINAS_CRONOMETRO;
  else process.env.MAQUINAS_CRONOMETRO = interruptorAntes;
});

// Nota de autoservicio pagada con la máquina asignada en el hueco que toca.
async function notaCon(maquinaId, slot = 'lavadora') {
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO',
    tipo_prenda: 'ROPA',
    estado_pago: 'PAGADO',
    forma_pago: 'EFECTIVO',
    cargas: [slot === 'lavadora' ? { lavadora_tipo: 'mediana' } : { secadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot, maquina_id: maquinaId }).expect(200);
  return { notaId: creada.body.id, cargaId: creada.body.cargas[0].id };
}

const maquina = async (id) => {
  const { rows } = await pool.query('SELECT * FROM maquinas WHERE id = $1', [id]);
  return rows[0];
};

const encender = (notaId, maquinaId) =>
  request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
    .send({ maquina_id: maquinaId });

async function lavadora(marca = 'LG', nombre = 'L1', minutos = 15) {
  await seedMarca({ nombre: marca, tipo: 'lavadora', tamano: 'mediana', minutos });
  return seedMaquina({ nombre, tipo: 'lavadora_mediana', tamano: 'mediana', marca });
}

// Secadora de un modelo que PREGUNTA su tiempo (como la Sec49), con tres.
async function secadoraQuePregunta(nombre = 'S49') {
  await seedMarca({ nombre: 'Speed Queen', tipo: 'secadora', tamano: 'mediana' });
  await pool.query(
    `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, minutos_2, minutos_3, minutos_4, pregunta_tiempo)
     SELECT id, 'Sec49', 'secadora', 'mediana', 45, 10, 20, 30, TRUE FROM marcas_maquina WHERE nombre = 'Speed Queen'`
  );
  return seedMaquina({ nombre, tipo: 'secadora', tamano: 'mediana', marca: 'Speed Queen', modelo: 'Sec49' });
}

const cronometroDe = async (id) => {
  const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
  return res.body.find(x => x.id === id).cronometro;
};

describe('qué máquinas van con cronómetro', () => {
  it('todas: cualquier marca, sin marca y secadoras', async () => {
    const lg = await lavadora('LG', 'L1');
    const wh = await lavadora('Whirlpool', 'L2');
    const sinMarca = await seedMaquina({ nombre: 'L3', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana', marca: 'Samsung' });
    for (const id of [lg, wh, sinMarca, sec]) expect(await cronometroDe(id)).toBe(true);
  });

  it('también el modelo que pregunta su programa al iniciar (mig. 146)', async () => {
    const id = await secadoraQuePregunta();
    expect(await cronometroDe(id)).toBe(true);
  });

  it('las Speed Queen también, pero arrancan con Iniciar; las demás marcas no', async () => {
    const sq = await lavadora('Speed Queen', 'L8', 45);
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana', marca: 'Speed Queen' });
    const lg = await lavadora('LG', 'L1');
    const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const de = (id) => { const m = res.body.find(x => x.id === id); return [m.cronometro, m.con_iniciar]; };
    expect(de(sq)).toEqual([true, true]);
    expect(de(sec)).toEqual([true, true]);
    expect(de(lg)).toEqual([true, false]);
  });

  it('con MAQUINAS_CRONOMETRO=off ninguna', async () => {
    const id = await lavadora();
    process.env.MAQUINAS_CRONOMETRO = 'off';
    expect(await cronometroDe(id)).toBe(false);
  });
});

describe('encender', () => {
  it('arranca la carga en el acto: cronómetro desde ya y los minutos de su marca como tope', async () => {
    const id = await lavadora('LG', 'L1', 15);
    const { notaId } = await notaCon(id);

    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.estado).toBe('en_uso');
    expect(m.en_uso_desde).not.toBeNull();            // el cronómetro corre
    expect(m.encendida_sin_iniciar_at).toBeNull();    // no queda "esperando arranque"
    expect(m.ciclo_minutos).toBe(15);                 // su tope

    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200);
    expect(nota.body.estado).toBe('LAVANDO');
    expect(nota.body.cargas[0].lavadora_iniciada_at).not.toBeNull();
    expect(nota.body.cargas[0].maquinas_usadas[0].cronometro).toBe(true);
    // Salidas lo usa para avisar que llegó al tope.
    expect(nota.body.cargas[0].lavadora_ciclo_minutos).toBe(15);
  });

  it('sin tiempo de modelo ni de marca, el tope es el de su tamaño en Ajustes', async () => {
    const id = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);
    expect((await maquina(id)).ciclo_minutos).toBe(30);
  });

  it('pulsado dos veces no reinicia el cronómetro', async () => {
    const id = await lavadora();
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);
    const antes = (await maquina(id)).en_uso_desde;

    await encender(notaId, id).expect(200);
    expect((await maquina(id)).en_uso_desde).toEqual(antes);
  });

  it('otra nota no la puede tomar mientras corre', async () => {
    const id = await lavadora();
    const a = await notaCon(id);
    const b = await notaCon(id);
    await encender(a.notaId, id).expect(200);
    expect((await encender(b.notaId, id)).status).toBe(409);
  });

  it('una secadora también arranca en el acto', async () => {
    const id = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const { notaId } = await notaCon(id, 'secadora');
    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.en_uso_desde).not.toBeNull();
    expect(m.ciclo_minutos).toBe(40);
  });

  it('el modelo que pregunta su tiempo sigue con sus dos pasos', async () => {
    const id = await secadoraQuePregunta();
    const { notaId } = await notaCon(id, 'secadora');
    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.en_uso_desde).toBeNull();
    expect(m.encendida_sin_iniciar_at).not.toBeNull();
  });
});

describe('lavadora Speed Queen', () => {
  // Sin paso de encender (2026-10-04): Iniciar le da corriente y arranca.
  it('Iniciar sin encender antes arranca el cronómetro con su tope', async () => {
    const id = await lavadora('Speed Queen', 'L8', 45);
    const { notaId } = await notaCon(id);

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: id }).expect(200);
    const m = await maquina(id);
    expect(m.estado).toBe('en_uso');
    expect(m.en_uso_desde).not.toBeNull();
    expect(m.encendida_sin_iniciar_at).toBeNull();
    expect(m.ciclo_minutos).toBe(45);                  // su tope

    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200);
    const usada = nota.body.cargas[0].maquinas_usadas[0];
    expect([usada.cronometro, usada.con_iniciar]).toEqual([true, true]);
  });

  it('ya iniciada se finaliza a mano como cualquier cronómetro', async () => {
    const id = await lavadora('Speed Queen', 'L8', 45);
    const { notaId } = await notaCon(id);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: id }).expect(200);

    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: id }).expect(200);
    expect((await maquina(id)).estado).toBe('disponible');
  });
});

describe('un solo ciclo, se finaliza a mano', () => {
  it('no ofrece segunda vuelta aunque su modelo diga dos ciclos', async () => {
    await seedMarca({ nombre: 'LG', tipo: 'lavadora', tamano: 'mediana', minutos: 15, modelo: 'WM-2C', dos_ciclos: true });
    const id = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG', modelo: 'WM-2C' });
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);

    const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = res.body.find(x => x.id === id);
    expect(m.cronometro).toBe(true);
    expect(m.ciclos_max).toBe(1);
    expect(m.otro_ciclo_desde).toBeNull();
  });

  it('se puede finalizar en cualquier momento y queda libre', async () => {
    const id = await lavadora();
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: id });
    expect(res.status).toBe(200);
    expect(res.body.estado).not.toBe('LAVANDO');   // la carga ya cerró
    expect((await maquina(id)).estado).toBe('disponible');
  });

  it('encender la secadora de la carga suelta la lavadora que seguía apartada', async () => {
    const lav = await lavadora();
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana', secadora_tipo: 'mediana' }],
    });
    const notaId = creada.body.id;
    const cargaId = creada.body.cargas[0].id;
    for (const [slot, maquinaId] of [['lavadora', lav], ['secadora', sec]]) {
      await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
        .send({ carga_id: cargaId, slot, maquina_id: maquinaId }).expect(200);
    }
    await encender(notaId, lav).expect(200);
    await encender(notaId, sec).expect(200);

    expect((await maquina(lav)).estado).toBe('disponible');
    expect((await maquina(sec)).estado).toBe('en_uso');
  });
});

describe('secadora Speed Queen desde la tarjeta de la lavadora (Autoservicio)', () => {
  it('INICIAR SECADO la arranca en el acto, sin paso de encender', async () => {
    const lav = await lavadora();
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana', marca: 'Speed Queen' });
    const { notaId } = await notaCon(lav);
    await encender(notaId, lav).expect(200);

    await request(app).patch(`/api/notas/${notaId}/terminar-lavado`).set(auth(admin.token))
      .send({ lavadora_id: lav, secadora_id: sec }).expect(200);

    const m = await maquina(sec);
    expect(m.estado).toBe('en_uso');
    expect(m.en_uso_desde).not.toBeNull();
    expect(m.ciclo_minutos).toBe(40);
    expect((await maquina(lav)).estado).toBe('disponible');
    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200);
    expect(nota.body.cargas[0].secadora_iniciada_at).not.toBeNull();
    expect(nota.body.estado).toBe('SECANDO');
  });

  it('la Sec49 arranca con el programa elegido y corta en su tope', async () => {
    const lav = await lavadora();
    const sec = await secadoraQuePregunta();
    const { notaId } = await notaCon(lav);
    await encender(notaId, lav).expect(200);

    await request(app).patch(`/api/notas/${notaId}/terminar-lavado`).set(auth(admin.token))
      .send({ lavadora_id: lav, secadora_id: sec, minutos: 20 }).expect(200);

    const m = await maquina(sec);
    expect(m.en_uso_desde).not.toBeNull();
    expect(m.ciclo_minutos).toBe(45);
    expect(m.ciclo_elegido_minutos).toBe(20);
  });

  it('una secadora de otra marca sigue arrancando en el acto', async () => {
    const lav = await lavadora();
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana', marca: 'Samsung' });
    const { notaId } = await notaCon(lav);
    await encender(notaId, lav).expect(200);

    await request(app).patch(`/api/notas/${notaId}/terminar-lavado`).set(auth(admin.token))
      .send({ lavadora_id: lav, secadora_id: sec }).expect(200);
    expect((await maquina(sec)).en_uso_desde).not.toBeNull();
  });
});

describe('el tope', () => {
  // Una máquina con Sonoff cuyo cronómetro empezó hace `minutos`, con tope 50.
  async function corriendoDesde(minutos) {
    const id = await lavadora();
    await pool.query(
      `UPDATE maquinas
          SET estado = 'en_uso', device_id = 'dev-test', ciclo_minutos = 50,
              en_uso_desde = NOW() - make_interval(mins => $2)
        WHERE id = $1`,
      [id, minutos]
    );
    return id;
  }

  const avisos = async (id) => {
    const { rows } = await pool.query(
      `SELECT mensaje FROM notificaciones WHERE tipo = 'tope_cronometro' AND maquina_id = $1`, [id]
    );
    return rows;
  };

  it('al pasarlo avisa en la campana, una sola vez', async () => {
    const id = await corriendoDesde(51);
    await sincronizarSonoff(id);
    await sincronizarSonoff(id, { reconciliando: true });

    const rows = await avisos(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].mensaje).toContain('50 min');
    // La nota no se toca: la máquina sigue apartada hasta que la finalicen.
    expect((await maquina(id)).estado).toBe('en_uso');
  });

  it('antes del tope no avisa nada', async () => {
    const id = await corriendoDesde(20);
    await sincronizarSonoff(id);
    expect(await avisos(id)).toHaveLength(0);
  });
});

// "Procesado" solo sale cuando al menos una lavadora de la nota terminó: el
// detalle lo lee de `lavadora_terminada`.
describe('GET /notas/:id — lavadora_terminada', () => {
  const terminada = async (notaId) =>
    (await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200)).body.lavadora_terminada;

  it('sin arrancar no hay ninguna terminada', async () => {
    const id = await lavadora();
    const { notaId } = await notaCon(id);
    expect(await terminada(notaId)).toBe(false);
  });

  it('con cronómetro corriendo no cuenta aunque lleve horas; finalizada, sí', async () => {
    const id = await lavadora();
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);
    await pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - interval '3 hours' WHERE id = $1`, [id]);
    expect(await terminada(notaId)).toBe(false);

    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: id }).expect(200);
    expect(await terminada(notaId)).toBe(true);
  });

  it('con temporizador cuenta en cuanto se cumple su tiempo', async () => {
    process.env.MAQUINAS_CRONOMETRO = 'off';
    const id = await lavadora('Whirlpool', 'L1', 15);
    const { notaId } = await notaCon(id);
    await encender(notaId, id).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: id }).expect(200);
    expect(await terminada(notaId)).toBe(false);

    await pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - interval '16 minutes' WHERE id = $1`, [id]);
    expect(await terminada(notaId)).toBe(true);
  });
});
