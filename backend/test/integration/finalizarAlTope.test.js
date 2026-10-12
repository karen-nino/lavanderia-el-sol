// Máquina con nota que llega a su TOPE: se finaliza sola, igual que con el
// botón FINALIZAR (2026-10-11). Medio minuto de gracia para que el aviso sonoro
// de la app suene antes de que la tarjeta desaparezca.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth } from '../helpers.js';
import { cancelarCortesProgramados } from '../../services/sincronizarSonoff.js';
import { finalizarMaquinasAlTope } from '../../jobs/finalizarAlTope.js';

let admin;

beforeEach(async () => {
  cancelarCortesProgramados();
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_secadora: 40 });
});

// Autoservicio con la máquina corriendo; `hace` = minutos desde que arrancó.
async function corriendo(slot, { pagada = true, hace }) {
  const maq = await seedMaquina(slot === 'lavadora'
    ? { nombre: 'L1', tipo: 'lavadora_mediana' }
    : { nombre: 'S1', tipo: 'secadora' });
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE',
    cargas: [slot === 'lavadora' ? { lavadora_tipo: 'mediana' } : { secadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  const notaId = creada.body.id;
  await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: creada.body.cargas[0].id, slot, maquina_id: maq }).expect(200);
  await request(app).patch(`/api/notas/${notaId}/encender-maquina`).set(auth(admin.token))
    .send({ maquina_id: maq }).expect(200);
  // El Autoservicio nace pendiente y se cobra en el detalle (2026-09-23).
  if (pagada) {
    await request(app).patch(`/api/notas/${notaId}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
  }
  // Se lleva el arranque al pasado (y la pasada viva con él).
  await pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - make_interval(mins => $2) WHERE id = $1`, [maq, hace]);
  return { notaId, maq };
}

const estadoMaquina = async (id) => (await pool.query('SELECT estado FROM maquinas WHERE id = $1', [id])).rows[0].estado;
const estadoNota = async (id) => (await pool.query('SELECT estado FROM notas WHERE id = $1', [id])).rows[0].estado;

describe('finalizar al llegar al tope', () => {
  it('lavadora pasada de su tope: se libera y la nota pagada se finaliza', async () => {
    const { notaId, maq } = await corriendo('lavadora', { hace: 31 }); // tope 30 + gracia
    const hechas = await finalizarMaquinasAlTope();
    expect(hechas).toHaveLength(1);
    expect(await estadoMaquina(maq)).toBe('disponible');
    expect(await estadoNota(notaId)).toBe('FINALIZADA');
  });

  it('pendiente de pago: queda Por Cobrar (LISTA), como al finalizar a mano', async () => {
    const { notaId, maq } = await corriendo('lavadora', { pagada: false, hace: 31 });
    await finalizarMaquinasAlTope();
    expect(await estadoMaquina(maq)).toBe('disponible');
    expect(await estadoNota(notaId)).toBe('LISTA');
  });

  it('secadora pasada de su tope también se finaliza', async () => {
    const { maq } = await corriendo('secadora', { hace: 41 });
    await finalizarMaquinasAlTope();
    expect(await estadoMaquina(maq)).toBe('disponible');
  });

  it('antes del tope, o en la media minuto de gracia, no se toca', async () => {
    const antes = await corriendo('lavadora', { hace: 20 });
    expect(await finalizarMaquinasAlTope()).toHaveLength(0);
    expect(await estadoMaquina(antes.maq)).toBe('en_uso');

    // Justo en el tope: todavía dentro de la gracia (para que suene el aviso).
    await pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - interval '30 minutes 10 seconds' WHERE id = $1`, [antes.maq]);
    expect(await finalizarMaquinasAlTope()).toHaveLength(0);
    expect(await estadoMaquina(antes.maq)).toBe('en_uso');
  });

  it('la encendida a mano sin nota no se toca', async () => {
    const maq = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana' });
    await pool.query(`UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() - interval '5 hours',
                      ciclo_minutos = 30, encendida_manual_at = NOW() WHERE id = $1`, [maq]);
    expect(await finalizarMaquinasAlTope()).toHaveLength(0);
    expect(await estadoMaquina(maq)).toBe('en_uso');
  });
});
