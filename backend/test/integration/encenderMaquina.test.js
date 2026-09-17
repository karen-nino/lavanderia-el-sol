// Encender la máquina ANTES de arrancar su ciclo (mig. 110).
//
// "Iniciar Lavado" hacía dos cosas a la vez: cerrar el relé y arrancar el
// cronómetro. Pero la lavadora no arranca sola al recibir corriente —hay que
// apretar su botón— y antes todavía hay que meter la ropa: todo ese rato se le
// descontaba al ciclo. Con el corte por fin de ciclo activo, la corriente se
// iba antes de que el lavado terminara.
//
// Lo que se fija aquí: que encender deje la máquina apartada y con corriente
// pero SIN cronómetro, que el segundo paso sí lo arranque, que la espera
// caduque sola, y que una máquina ajena a la nota no se pueda encender.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth,
} from '../helpers.js';
import { esperandoArranque, ESPERA_ARRANQUE_MINUTOS } from '../../services/sincronizarSonoff.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 15, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 30 });
});

// Nota de autoservicio pagada con una lavadora asignada, SIN arrancar.
async function notaConLavadora(lavadoraId) {
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
  return creada.body.id;
}

const maquina = async (id) => {
  const { rows } = await pool.query('SELECT * FROM maquinas WHERE id = $1', [id]);
  return rows[0];
};

const encender = (notaId, maquinaId) =>
  request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
    .send({ maquina_id: maquinaId });

const iniciar = (notaId, maquinaId) =>
  request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
    .send({ maquina_id: maquinaId });

describe('encender — el paso previo', () => {
  it('da corriente y aparta la máquina, pero NO arranca el cronómetro', async () => {
    const id = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);

    await encender(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.estado).toBe('en_uso');                       // apartada
    expect(m.encendida_sin_iniciar_at).not.toBeNull();     // con corriente
    expect(m.en_uso_desde).toBeNull();                     // sin cronómetro
    expect(m.ciclo_minutos).toBeNull();                    // sin ciclo que cortar
    expect(esperandoArranque(m)).toBe(true);
  });

  it('la nota la muestra esperando arranque, que es lo que cambia el botón', async () => {
    const id = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);
    await encender(notaId, id).expect(200);

    const r = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token)).expect(200);
    expect(r.body.cargas[0].lavadora_esperando_arranque).toBe(true);
  });

  it('pulsarlo dos veces no es un error', async () => {
    const id = await seedMaquina({ nombre: 'L3', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);

    await encender(notaId, id).expect(200);
    await encender(notaId, id).expect(200);
  });

  it('una máquina que no es de la nota no se enciende', async () => {
    const mia = await seedMaquina({ nombre: 'L4', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const ajena = await seedMaquina({ nombre: 'L5', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(mia);

    const r = await encender(notaId, ajena);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no está asignada/i);
  });
});

describe('iniciar — el segundo paso', () => {
  it('arranca el cronómetro sobre la máquina ya encendida y borra la espera', async () => {
    const id = await seedMaquina({ nombre: 'L6', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);
    await encender(notaId, id).expect(200);

    await iniciar(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.estado).toBe('en_uso');
    expect(m.en_uso_desde).not.toBeNull();            // ahora sí corre el tiempo
    expect(m.ciclo_minutos).toBe(15);                 // ciclo sellado
    expect(m.encendida_sin_iniciar_at).toBeNull();    // la espera terminó bien
    expect(m.encendida_para_nota_id).toBeNull();
  });

  it('sin encender antes sigue funcionando: el paso previo es opcional', async () => {
    const id = await seedMaquina({ nombre: 'L7', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);

    await iniciar(notaId, id).expect(200);

    const m = await maquina(id);
    expect(m.en_uso_desde).not.toBeNull();
    expect(m.ciclo_minutos).toBe(15);
  });

  it('el reloj del ciclo cuenta desde Iniciar, no desde Encender', async () => {
    const id = await seedMaquina({ nombre: 'L8', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);
    await encender(notaId, id).expect(200);

    // Se envejece el encendido: como si el empleado hubiera tardado en cargar.
    await pool.query(
      `UPDATE maquinas SET encendida_sin_iniciar_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [id]
    );
    await iniciar(notaId, id).expect(200);

    const { rows } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - en_uso_desde)) AS seg FROM maquinas WHERE id = $1`,
      [id]
    );
    // Si contara desde Encender, aquí habría ~120 s gastados del ciclo.
    expect(Number(rows[0].seg)).toBeLessThan(5);
  });
});

describe('la espera caduca', () => {
  it(`deja de valer pasados los ${ESPERA_ARRANQUE_MINUTOS} min`, async () => {
    const id = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const notaId = await notaConLavadora(id);
    await encender(notaId, id).expect(200);

    await pool.query(
      `UPDATE maquinas
          SET encendida_sin_iniciar_at = NOW() - ($2 * INTERVAL '1 minute') - INTERVAL '1 minute'
        WHERE id = $1`,
      [id, ESPERA_ARRANQUE_MINUTOS]
    );

    expect(esperandoArranque(await maquina(id))).toBe(false);
  });
});
