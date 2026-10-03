// Lavadoras LG y Samsung con CRONÓMETRO (mig. 137).
//
// Al encenderlas empieza a contar hacia arriba —no hay paso de "Iniciar"—, la
// carga corre un solo ciclo y termina cuando alguien la finaliza. Lo único que
// las apaga solas es el tope de Ajustes, y entonces se avisa en la campana.
//
// Lo que se fija aquí: que encender arranque la carga en el acto con el tope
// sellado como ciclo, que solo aplique a lavadoras de esas marcas, que no se
// ofrezca segunda vuelta, que se puedan finalizar en cualquier momento, y que
// el aviso del tope salga una sola vez.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth,
} from '../helpers.js';
import { sincronizarSonoff, cancelarCortesProgramados } from '../../services/sincronizarSonoff.js';
import { esCronometro } from '../../db/sqlMaquina.js';

let admin;

beforeEach(async () => {
  cancelarCortesProgramados();
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({
    tiempo_carga_mediana: 15, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 30,
    tope_cronometro_minutos: 50,
  });
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
  return creada.body.id;
}

const maquina = async (id) => {
  const { rows } = await pool.query('SELECT * FROM maquinas WHERE id = $1', [id]);
  return rows[0];
};

const encender = (notaId, maquinaId) =>
  request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
    .send({ maquina_id: maquinaId });

async function lavadora(marca, nombre = 'L1') {
  await seedMarca({ nombre: marca, tipo: 'lavadora', tamano: 'mediana', minutos: 15 });
  return seedMaquina({ nombre, tipo: 'lavadora_mediana', tamano: 'mediana', marca });
}

describe('qué máquinas van con cronómetro', () => {
  it('LG y Samsung, sin importar mayúsculas ni espacios; solo lavadoras', () => {
    expect(esCronometro({ tipo: 'lavadora_mediana', marca: 'LG' })).toBe(true);
    expect(esCronometro({ tipo: 'lavadora_jumbo', marca: ' samsung ' })).toBe(true);
    expect(esCronometro({ tipo: 'secadora', marca: 'Samsung' })).toBe(false);
    expect(esCronometro({ tipo: 'lavadora_mediana', marca: 'Speed Queen' })).toBe(false);
    expect(esCronometro({ tipo: 'lavadora_mediana', marca: null })).toBe(false);
  });
});

describe('encender una LG o Samsung', () => {
  it('arranca la carga en el acto: cronómetro desde ya y el tope como ciclo', async () => {
    const id = await lavadora('LG');
    const notaId = await notaCon(id);

    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.estado).toBe('en_uso');
    expect(m.en_uso_desde).not.toBeNull();            // el cronómetro corre
    expect(m.encendida_sin_iniciar_at).toBeNull();    // no queda "esperando arranque"
    expect(m.ciclo_minutos).toBe(50);                 // el tope, no los 15 de la marca

    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200);
    expect(nota.body.estado).toBe('LAVANDO');
    expect(nota.body.cargas[0].lavadora_iniciada_at).not.toBeNull();
  });

  it('Samsung igual', async () => {
    const id = await lavadora('Samsung');
    const notaId = await notaCon(id);
    await encender(notaId, id).expect(200);
    expect((await maquina(id)).en_uso_desde).not.toBeNull();
  });

  it('pulsado dos veces no reinicia el cronómetro', async () => {
    const id = await lavadora('LG');
    const notaId = await notaCon(id);
    await encender(notaId, id).expect(200);
    const antes = (await maquina(id)).en_uso_desde;

    await encender(notaId, id).expect(200);
    expect((await maquina(id)).en_uso_desde).toEqual(antes);
  });

  it('otra nota no la puede tomar mientras corre', async () => {
    const id = await lavadora('LG');
    const notaA = await notaCon(id);
    const notaB = await notaCon(id);
    await encender(notaA, id).expect(200);

    const r = await encender(notaB, id);
    expect(r.status).toBe(409);
  });

  it('las demás marcas siguen con los dos pasos de siempre', async () => {
    const id = await lavadora('Whirlpool');
    const notaId = await notaCon(id);
    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.en_uso_desde).toBeNull();
    expect(m.encendida_sin_iniciar_at).not.toBeNull();
  });

  it('una secadora Samsung sigue con temporizador', async () => {
    await seedMarca({ nombre: 'Samsung', tipo: 'secadora', tamano: 'mediana', minutos: 30 });
    const id = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana', marca: 'Samsung' });
    const notaId = await notaCon(id, 'secadora');
    await encender(notaId, id).expect(200);

    expect((await maquina(id)).en_uso_desde).toBeNull();
  });
});

describe('un solo ciclo, se finaliza a mano', () => {
  it('no ofrece segunda vuelta aunque su modelo diga dos ciclos', async () => {
    await seedMarca({ nombre: 'LG', tipo: 'lavadora', tamano: 'mediana', minutos: 15, modelo: 'WM-2C', dos_ciclos: true });
    const id = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana', marca: 'LG', modelo: 'WM-2C' });
    const notaId = await notaCon(id);
    await encender(notaId, id).expect(200);

    const res = await request(app).get('/api/maquinas').set(auth(admin.token)).expect(200);
    const m = res.body.find(x => x.id === id);
    expect(m.marca_opciones.cronometro).toBe(true);
    expect(m.ciclos_max).toBe(1);
    expect(m.otro_ciclo_desde).toBeNull();
  });

  it('se puede finalizar en cualquier momento y queda libre', async () => {
    const id = await lavadora('LG');
    const notaId = await notaCon(id);
    await encender(notaId, id).expect(200);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: id });
    expect(res.status).toBe(200);
    expect(res.body.estado).not.toBe('LAVANDO');   // la carga ya cerró
    expect((await maquina(id)).estado).toBe('disponible');
  });
});

describe('el tope', () => {
  // Una LG con Sonoff cuyo cronómetro empezó hace `minutos`.
  async function lgCorriendoDesde(minutos) {
    const id = await lavadora('LG');
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
    const id = await lgCorriendoDesde(51);
    await sincronizarSonoff(id);
    await sincronizarSonoff(id, { reconciliando: true });

    const rows = await avisos(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].mensaje).toContain('50 min');
    // La nota no se toca: la máquina sigue apartada hasta que la finalicen.
    expect((await maquina(id)).estado).toBe('en_uso');
  });

  it('antes del tope no avisa nada', async () => {
    const id = await lgCorriendoDesde(20);
    await sincronizarSonoff(id);
    expect(await avisos(id)).toHaveLength(0);
  });

  it('se configura en Ajustes y no acepta menos de 1 minuto', async () => {
    await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tope_cronometro_minutos: 0 }).expect(400);
    await request(app).patch('/api/ajustes').set(auth(admin.token))
      .send({ tope_cronometro_minutos: 90 }).expect(200);
    const { rows } = await pool.query('SELECT tope_cronometro_minutos FROM ajustes WHERE id = 1');
    expect(rows[0].tope_cronometro_minutos).toBe(90);
  });
});
