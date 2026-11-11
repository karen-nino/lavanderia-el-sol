// Admin, desde Gestión de máquinas: soltar una máquina reservada que su nota
// nunca arrancó (p. ej., el cliente pagó y no regresó), con el corte cerrado
// y dejando la nota abierta o finalizándola.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth } from '../helpers.js';

let admin, adminMain, empleado;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  adminMain = await seedUsuario({ rol: 'admin_main', sucursal: 'centro', nombre: 'Main' });
  empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
  await seedAjustes({ tiempo_carga_secadora: 40 });
});
const api = (m, u, b, quien = admin) => request(app)[m](u).set(auth(quien.token)).send(b);

/** Autoservicio cobrado con la secadora S5 asignada y sin arrancar, cobrado en un corte ya cerrado. */
async function reservada() {
  await api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);
  await seedMarca({ nombre: 'LG', tipo: 'secadora', tamano: 'mediana', minutos: 30 });
  const sec = await seedMaquina({ nombre: 'S5', tipo: 'secadora', marca: 'LG' });
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ secadora_tipo: 'mediana' }],
  }).expect(201);
  await api('patch', `/api/notas/${n.body.id}/asignar-carga-maquina`,
    { carga_id: n.body.cargas[0].id, slot: 'secadora', maquina_id: sec }).expect(200);
  // Se cobra ya con la máquina tarifada.
  await api('patch', `/api/notas/${n.body.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
  await pool.query("UPDATE cajas SET estado = 'cerrada', cerrada_at = NOW()");
  return { sec, nota: n.body.id };
}

const maquina = async (id) => (await api('get', '/api/maquinas').expect(200)).body.find(m => m.id === id);
const nota = async (id) => (await pool.query(
  `SELECT n.estado, n.precio_total AS total, nc.secadora_id, nc.secadora_usada_id
     FROM notas n JOIN nota_cargas nc ON nc.nota_id = n.id WHERE n.id = $1`, [id]
)).rows[0];

describe('liberar una máquina reservada', () => {
  it('la deja disponible y la nota sigue abierta, sin máquina y con su total', async () => {
    const { sec, nota: id } = await reservada();
    expect((await maquina(sec)).reservada).toBe(true);
    expect((await maquina(sec)).reservada_finalizable).toBe(true);
    const antes = await nota(id);

    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }).expect(200);

    expect((await maquina(sec)).reservada).toBe(false);
    const despues = await nota(id);
    expect(despues.estado).toBe('EN_ESPERA');
    expect(despues.secadora_id).toBeNull();
    expect(despues.secadora_usada_id).toBeNull();
    expect(despues.total).toBe(antes.total);
  });

  it('con finalizar, cierra el Autoservicio cobrado', async () => {
    const { sec, nota: id } = await reservada();
    const r = await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id, finalizar: true });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('FINALIZADA');
    expect((await nota(id)).estado).toBe('FINALIZADA');
    expect((await maquina(sec)).reservada).toBe(false);
  });

  it('con otra máquina en la nota no ofrece finalizar', async () => {
    const { sec, nota: id } = await reservada();
    const lav = await seedMaquina({ nombre: 'L9', tipo: 'lavadora_mediana' });
    await pool.query('UPDATE nota_cargas SET lavadora_id = $1 WHERE nota_id = $2', [lav, id]);
    const m = await maquina(sec);
    expect(m.reservada_liberable).toBe(true);
    expect(m.reservada_finalizable).toBe(false);
  });

  it('si la nota ya la arrancó, no se ofrece liberar', async () => {
    const { sec, nota: id } = await reservada();
    await pool.query('UPDATE nota_cargas SET secadora_iniciada_at = NOW() WHERE nota_id = $1', [id]);
    expect((await maquina(sec)).reservada_liberable).toBe(false);
    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }).expect(409);
  });

  it('no suelta una máquina que ya está en uso', async () => {
    const { sec, nota: id } = await reservada();
    await pool.query("UPDATE maquinas SET estado = 'en_uso' WHERE id = $1", [sec]);
    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }).expect(409);
    expect((await nota(id)).secadora_id).toBe(sec);
  });

  it('es solo de admin', async () => {
    const { sec, nota: id } = await reservada();
    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }, empleado).expect(403);
  });
});

describe('finalizar un Autoservicio cobrado que se quedó sin máquina', () => {
  it('el Admin Main lo finaliza desde En espera', async () => {
    const { sec, nota: id } = await reservada();
    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }).expect(200);
    await api('patch', `/api/notas/${id}/estado`, { estado: 'FINALIZADA' }, adminMain).expect(200);
    expect((await nota(id)).estado).toBe('FINALIZADA');
  });

  it('un admin normal no puede', async () => {
    const { sec, nota: id } = await reservada();
    await api('patch', `/api/maquinas/${sec}/liberar`, { nota_id: id }).expect(200);
    await api('patch', `/api/notas/${id}/estado`, { estado: 'FINALIZADA' }).expect(400);
  });

  it('no si todavía tiene la máquina asignada', async () => {
    const { nota: id } = await reservada();
    await api('patch', `/api/notas/${id}/estado`, { estado: 'FINALIZADA' }, adminMain).expect(409);
    expect((await nota(id)).estado).toBe('EN_ESPERA');
  });
});

describe('otra vuelta sin arrancar (Relavado / Más secado) en Por Encargo', () => {
  /** Por Encargo: lava en L1 hasta terminar y luego pide relavado en L2, sin arrancarlo. */
  async function relavadoSinArrancar() {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana' });
    const n = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    const id = n.body.id;
    const carga = n.body.cargas[0].id;
    await api('patch', `/api/notas/${id}/asignar-carga-maquina`, { carga_id: carga, slot: 'lavadora', maquina_id: l1 }).expect(200);
    await api('patch', `/api/notas/${id}/activar-pendientes`, { maquina_id: l1 }).expect(200);
    await api('patch', `/api/notas/${id}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    const primera = (await pool.query('SELECT lavadora_iniciada_at FROM nota_cargas WHERE id = $1', [carga])).rows[0].lavadora_iniciada_at;
    await api('patch', `/api/notas/${id}/asignar-maquina`, { maquina_ids: [l2], carga_id: carga, cobrar: false }).expect(200);
    return { l1, l2, id, carga, primera };
  }

  const cargaDe = async (carga) => (await pool.query(
    'SELECT lavadora_id, lavadora_usada_id, lavadora_iniciada_at FROM nota_cargas WHERE id = $1', [carga]
  )).rows[0];
  const vueltas = async (carga) => (await pool.query(
    'SELECT maquina_nombre FROM nota_carga_maquinas WHERE carga_id = $1 ORDER BY id', [carga]
  )).rows.map(r => r.maquina_nombre);

  it('al liberarla, la carga conserva el primer lavado', async () => {
    const { l1, l2, id, carga, primera } = await relavadoSinArrancar();
    await api('patch', `/api/maquinas/${l2}/liberar`, { nota_id: id }).expect(200);
    const c = await cargaDe(carga);
    expect(c.lavadora_id).toBeNull();
    expect(c.lavadora_usada_id).toBe(l1);
    expect(c.lavadora_iniciada_at).not.toBeNull();
    expect(new Date(c.lavadora_iniciada_at).getTime()).toBeCloseTo(new Date(primera).getTime(), -3);
    expect(await vueltas(carga)).toEqual(['L1']);
  });

  it('al marcarla Procesado (Por Entregar), Más secado sin arrancar no borra el primer secado', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const s1 = await seedMaquina({ nombre: 'S1', tipo: 'secadora' });
    const s2 = await seedMaquina({ nombre: 'S2', tipo: 'secadora' });
    const n = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', secadora_tipo: 'mediana' }],
    }).expect(201);
    const id = n.body.id;
    const carga = n.body.cargas[0].id;
    await api('patch', `/api/notas/${id}/asignar-carga-maquina`, { carga_id: carga, slot: 'lavadora', maquina_id: l1 }).expect(200);
    await api('patch', `/api/notas/${id}/activar-pendientes`, { maquina_id: l1 }).expect(200);
    await api('patch', `/api/notas/${id}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    await api('patch', `/api/notas/${id}/asignar-carga-maquina`, { carga_id: carga, slot: 'secadora', maquina_id: s1 }).expect(200);
    await api('patch', `/api/notas/${id}/activar-pendientes`, { maquina_id: s1 }).expect(200);
    await api('patch', `/api/notas/${id}/terminar-secado`, { secadora_id: s1 }).expect(200);
    await api('patch', `/api/notas/${id}/asignar-maquina`, { maquina_ids: [s2], carga_id: carga, cobrar: false }).expect(200);

    await api('patch', `/api/notas/${id}/estado`, { estado: 'LISTA' }).expect(200);
    const { rows: [c] } = await pool.query(
      'SELECT secadora_id, secadora_usada_id, secadora_iniciada_at FROM nota_cargas WHERE id = $1', [carga]);
    expect(c.secadora_id).toBeNull();
    expect(c.secadora_usada_id).toBe(s1);
    expect(c.secadora_iniciada_at).not.toBeNull();
    const { rows } = await pool.query(
      "SELECT maquina_nombre FROM nota_carga_maquinas WHERE carga_id = $1 AND slot = 'secadora'", [carga]);
    expect(rows.map(r => r.maquina_nombre)).toEqual(['S1']);
  });

  it('el cierre de medianoche también conserva el primer lavado', async () => {
    const { l1, carga } = await relavadoSinArrancar();
    const { liberarMaquinasCierreDelDia } = await import('../../jobs/cierreDelDia.js');
    await liberarMaquinasCierreDelDia();
    const c = await cargaDe(carga);
    expect(c.lavadora_id).toBeNull();
    expect(c.lavadora_usada_id).toBe(l1);
    expect(await vueltas(carga)).toEqual(['L1']);
  });
});
