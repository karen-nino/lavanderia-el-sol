// Reporte diario de Máquinas: por máquina, las vueltas que arrancaron ese día,
// su nota y lo generado; también lo ve un empleado.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({ precio_carga_mediana: 70 });
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

/** Autoservicio que asigna la lavadora y, si `iniciar`, le da a Iniciar. */
const notaEn = async (lav, iniciar = true) => {
  const nota = (await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ lavadora_tipo: 'mediana' }],
  })).body;
  await request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
    .send({ carga_id: nota.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
  if (iniciar) {
    await request(app).patch(`/api/notas/${nota.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav }).expect(200);
  }
  return nota;
};

describe('GET /api/maquinas/reporte-diario', () => {
  it('cuenta solo las vueltas que arrancaron, con su nota y lo generado', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const otra = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana' });
    const usada = await notaEn(lav);
    await notaEn(otra, false); // asignada sin iniciar: no cuenta

    const res = await request(app).get('/api/maquinas/reporte-diario').set(auth(admin.token));
    expect(res.status).toBe(200);
    const l1 = res.body.maquinas.find((m) => m.id === lav);
    const l2 = res.body.maquinas.find((m) => m.id === otra);
    expect(l1.usos).toBe(1);
    expect(l1.generado).toBe(70);
    expect(l1.pasadas[0].nota_id).toBe(usada.id);
    expect(l1.pasadas[0].en_curso).toBe(true);
    expect(l2.usos).toBe(0);
    expect(l2.generado).toBe(0);
  });

  it('deja fuera las canceladas y otros días', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const cancelada = await notaEn(lav);
    await pool.query("UPDATE notas SET estado = 'CANCELADA' WHERE id = $1", [cancelada.id]);

    const hoy = await request(app).get('/api/maquinas/reporte-diario').set(auth(admin.token));
    expect(hoy.body.maquinas[0].usos).toBe(0);
    const otroDia = await request(app).get('/api/maquinas/reporte-diario?fecha=2026-01-01').set(auth(admin.token));
    expect(otroDia.body.fecha).toBe('2026-01-01');
    expect(otroDia.body.maquinas[0].usos).toBe(0);
  });

  it('también lo ve un empleado (200)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).get('/api/maquinas/reporte-diario').set(auth(empleado.token));
    expect(res.status).toBe(200);
  });
});
