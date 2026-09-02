import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth } from '../helpers.js';
import pool from '../../db/pool.js';
import { liberarMaquinasCierreDelDia } from '../../jobs/cierreDelDia.js';

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70 });
});

const reservada = async (id) => {
  const r = await request(app).get('/api/maquinas').set(auth(admin.token));
  const m = r.body.find(x => x.id === id);
  return { estado: m.estado, reservada: m.reservada, folio: m.reservada_folio };
};

async function notaConMaquinaAsignada(nombre) {
  const lav = await seedMaquina({ nombre, tipo: 'lavadora_mediana' });
  const nota = (await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ lavadora_tipo: 'mediana' }],
  })).body;
  await request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: nota.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
  return { notaId: nota.id, lav };
}

describe('¿cuándo se suelta una máquina apartada?', () => {
  it('al CREAR la nota (solo tipo) no se aparta ninguna máquina', async () => {
    const lav = await seedMaquina({ nombre: 'L0', tipo: 'lavadora_mediana' });
    await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    console.log('  tras crear la nota:', await reservada(lav));
    expect((await reservada(lav)).reservada).toBe(false);
  });

  it('asignada pero SIN arrancar: queda apartada', async () => {
    const { lav } = await notaConMaquinaAsignada('L1');
    console.log('  asignada sin arrancar:', await reservada(lav));
    expect((await reservada(lav)).reservada).toBe(true);
  });

  it('el CIERRE DEL DÍA ¿la suelta?', async () => {
    const { notaId, lav } = await notaConMaquinaAsignada('L2');
    const r = await liberarMaquinasCierreDelDia();
    const estadoNota = (await pool.query('SELECT estado FROM notas WHERE id = $1', [notaId])).rows[0].estado;
    console.log('  cierre del día →', JSON.stringify(r), '| nota:', estadoNota, '| máquina:', await reservada(lav));
  });

  it('cancelar la nota la suelta', async () => {
    const { notaId, lav } = await notaConMaquinaAsignada('L3');
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token))
      .send({ estado: 'CANCELADA' }).expect(200);
    console.log('  tras cancelar:', await reservada(lav));
    expect((await reservada(lav)).reservada).toBe(false);
  });

  it('quitar la máquina de la nota la suelta', async () => {
    const { notaId, lav } = await notaConMaquinaAsignada('L4');
    const r = await request(app).patch(`/api/notas/${notaId}/quitar-maquina`).set(auth(admin.token))
      .send({ maquina_id: lav });
    console.log('  quitar-maquina:', r.status, '|', await reservada(lav));
  });

  it('si la nota llega a LISTA, la máquina deja de estar apartada', async () => {
    const { notaId, lav } = await notaConMaquinaAsignada('L5');
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token))
      .send({ estado: 'LISTA' }).expect(200);
    console.log('  nota LISTA →', await reservada(lav));
  });
});
