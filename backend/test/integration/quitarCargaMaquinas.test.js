// Quitar una carga (DELETE /notas/:id/cargas/:cargaId) que nunca arrancó.
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
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const estado = async (id) => (await pool.query('SELECT estado FROM maquinas WHERE id = $1', [id])).rows[0].estado;

async function notaAuto(cargas = 1) {
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: Array.from({ length: cargas }, () => ({ lavadora_tipo: 'mediana' })),
  });
  expect(n.status).toBe(201);
  return n.body;
}
const asignar = (nota, carga, maq) => api('patch', `/api/notas/${nota.id}/asignar-carga-maquina`,
  { carga_id: carga.id, slot: 'lavadora', maquina_id: maq }).expect(200);

describe('quitar una carga', () => {
  it('no suelta la lavadora que OTRA nota está usando', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const a = await notaAuto(2);
    await asignar(a, a.cargas[1], l1);            // A la tiene asignada, sin arrancar
    const b = await notaAuto(1);
    await asignar(b, b.cargas[0], l1);
    await api('patch', `/api/notas/${b.id}/activar-pendientes`, { maquina_id: l1 }).expect(200);
    expect(await estado(l1)).toBe('en_uso');      // B la está usando

    await api('delete', `/api/notas/${a.id}/cargas/${a.cargas[1].id}`).expect(200);
    expect(await estado(l1)).toBe('en_uso');
  });

  it('sí apaga la que ESTA nota encendió y no arrancó', async () => {
    process.env.MAQUINAS_CRONOMETRO = 'off';
    try {
      const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
      const a = await notaAuto(2);
      await asignar(a, a.cargas[1], l1);
      await api('patch', `/api/notas/${a.id}/encender-maquina`, { maquina_id: l1 }).expect(200);
      expect(await estado(l1)).toBe('en_uso');
      await api('delete', `/api/notas/${a.id}/cargas/${a.cargas[1].id}`).expect(200);
      expect(await estado(l1)).toBe('disponible');
    } finally { delete process.env.MAQUINAS_CRONOMETRO; }
  });

  it('no se quita una carga que ya lavó y espera su relavado', async () => {
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const a = await notaAuto(2);
    const c = a.cargas[0];
    await asignar(a, c, l1);
    await api('patch', `/api/notas/${a.id}/activar-pendientes`, { maquina_id: l1 }).expect(200);
    await api('patch', `/api/notas/${a.id}/terminar-lavado-final`, { lavadora_id: l1 }).expect(200);
    await api('patch', `/api/notas/${a.id}/asignar-maquina`, { maquina_ids: [l1], carga_id: c.id, cobrar: false }).expect(200);

    const res = await api('delete', `/api/notas/${a.id}/cargas/${c.id}`);
    expect(res.status).toBe(409);
  });
});
