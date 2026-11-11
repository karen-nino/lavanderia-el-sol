// Admin, desde Gestión de máquinas: soltar una máquina reservada que su nota
// nunca arrancó (p. ej., el cliente pagó y no regresó), con el corte cerrado
// y dejando la nota abierta o finalizándola.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth } from '../helpers.js';

let admin, empleado;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
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
