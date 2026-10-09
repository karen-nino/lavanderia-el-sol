// Una vuelta REPETIDA de una carga (relavado) que se asigna pero no se
// arranca no es "una máquina que esta nota arrancó": la marca de arranque
// de la carga (`lavadora_iniciada_at`, mig. 097) es de la vuelta anterior.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});

const api = (metodo, url, body) => request(app)[metodo](url).set(auth(admin.token)).send(body);

async function notaConLavadora(lavId) {
  const creada = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  const notaId = creada.body.id;
  const cargaId = creada.body.cargas[0].id;
  await api('patch', `/api/notas/${notaId}/asignar-carga-maquina`, { carga_id: cargaId, slot: 'lavadora', maquina_id: lavId }).expect(200);
  await api('patch', `/api/notas/${notaId}/activar-pendientes`, { maquina_id: lavId }).expect(200);
  return { notaId, cargaId };
}

const estado = async (id) => (await pool.query('SELECT estado FROM maquinas WHERE id = $1', [id])).rows[0].estado;

describe('relavado asignado sin arrancar', () => {
  it('cancelar la nota no suelta la lavadora que OTRA nota está usando', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const a = await notaConLavadora(l1);
    await api('patch', `/api/notas/${a.notaId}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    expect(await estado(l1)).toBe('disponible');

    // A pide otro lavado de la misma ropa en L1, pero no lo arranca.
    const r = await api('patch', `/api/notas/${a.notaId}/asignar-maquina`, { maquina_ids: [l1], carga_id: a.cargaId, cobrar: false });
    expect(r.status).toBe(200);

    // B se le adelanta y arranca L1.
    await notaConLavadora(l1);
    expect(await estado(l1)).toBe('en_uso');

    await api('patch', `/api/notas/${a.notaId}/estado`, { estado: 'CANCELADA' }).expect(200);
    expect(await estado(l1)).toBe('en_uso');
  });

  it('Ventas no cuenta como ciclo la vuelta que nunca arrancó', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const a = await notaConLavadora(l1);
    await api('patch', `/api/notas/${a.notaId}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    await api('patch', `/api/notas/${a.notaId}/asignar-maquina`, { maquina_ids: [l1], carga_id: a.cargaId, cobrar: false }).expect(200);

    const { rows } = await pool.query(
      `SELECT * FROM (${(await import('../../db/sqlMaquina.js')).CICLOS_DE_PASADAS('n.id = $1')}) c`, [a.notaId]);
    expect(rows).toHaveLength(1);
  });
});

describe('relavado que sí se arranca', () => {
  it('cuenta como su propio ciclo y al cancelar se suelta', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const a = await notaConLavadora(l1);
    await api('patch', `/api/notas/${a.notaId}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    await api('patch', `/api/notas/${a.notaId}/asignar-maquina`, { maquina_ids: [l1], carga_id: a.cargaId, cobrar: false }).expect(200);
    await api('patch', `/api/notas/${a.notaId}/activar-pendientes`, { maquina_id: l1 }).expect(200);
    expect(await estado(l1)).toBe('en_uso');

    const { rows } = await pool.query(
      `SELECT * FROM (${(await import('../../db/sqlMaquina.js')).CICLOS_DE_PASADAS('n.id = $1')}) c`, [a.notaId]);
    expect(rows).toHaveLength(2);

    await api('patch', `/api/notas/${a.notaId}/estado`, { estado: 'CANCELADA' }).expect(200);
    expect(await estado(l1)).toBe('disponible');
  });
});
