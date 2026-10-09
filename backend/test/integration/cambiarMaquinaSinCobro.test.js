// Cambiar la máquina de una carga que se agregó SIN COBRO no puede ponerle
// precio: "sin cobro" lo decidió el empleado al agregarla.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, seedMaquina, seedAjustes, auth } from '../helpers.js';

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const total = async (id) => Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [id])).rows[0].precio_total);

describe.each(['AUTOSERVICIO', 'POR_ENCARGO'])('%s: máquina extra sin cobro', (tipo) => {
  it('cambiarla por otra no sube el total', async () => {
    const cli = await seedCliente();
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const n = await api('post', '/api/notas', {
      tipo_servicio: tipo, ...(tipo === 'POR_ENCARGO' ? { cliente_id: cli } : {}), tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(n.status).toBe(201);
    const r = await api('patch', `/api/notas/${n.body.id}/asignar-maquina`, { maquina_ids: [l1], cobrar: false });
    expect(r.status).toBe(200);
    const antes = await total(n.body.id);
    const c = await api('patch', `/api/notas/${n.body.id}/cambiar-maquina`, { maquina_actual_id: l1, maquina_nueva_id: l2 });
    expect(c.status).toBe(200);
    expect(await total(n.body.id)).toBe(antes);
  });
});

describe('máquina que sí se cobra', () => {
  it('Autoservicio: cambiar a una jumbo re-tarifa la carga', async () => {
    await seedAjustes({ precio_carga_mediana: 70, precio_carga_jumbo: 100 });
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const n = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    await api('patch', `/api/notas/${n.body.id}/asignar-carga-maquina`,
      { carga_id: n.body.cargas[0].id, slot: 'lavadora', maquina_id: l1 }).expect(200);
    const antes = await total(n.body.id);
    expect(antes).toBeGreaterThan(0);
    await api('patch', `/api/notas/${n.body.id}/cambiar-maquina`, { maquina_actual_id: l1, maquina_nueva_id: l2 }).expect(200);
    expect(await total(n.body.id)).toBeGreaterThan(antes);
  });
});
