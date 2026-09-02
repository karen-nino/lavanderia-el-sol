import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedCliente, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/maquinas — aislamiento por sucursal', () => {
  it('solo lista las máquinas de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedMaquina({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedMaquina({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/maquinas').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });
});

describe('POST /api/maquinas — validaciones', () => {
  it('crea una máquina', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('L9');
    expect(res.body.sucursal).toBe('centro');
  });

  it('sin nombre o tipo → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo/i);
  });

  it('tipo inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'planchadora' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo inválido/i);
  });

  it('tamaño inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'gigante' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tamaño inválido/i);
  });
});

describe('PATCH /api/maquinas/:id/estado', () => {
  it('cambia el estado a mantenimiento', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'mantenimiento' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('mantenimiento');
  });

  it('estado inválido → 400', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'roto' });
    expect(res.status).toBe(400);
  });

  it('máquina inexistente → 404', async () => {
    const res = await request(app).patch('/api/maquinas/999999/estado').set(auth(admin.token))
      .send({ estado: 'disponible' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/maquinas/:id', () => {
  it('un empleado no puede eliminar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(empleado.token));
    expect(res.status).toBe(403);
  });

  it('el admin elimina una máquina', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(admin.token));
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT id FROM maquinas WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('una máquina de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajena = await seedMaquina({ nombre: 'Ajena', sucursal: 'norte' });
    const res = await request(app).delete(`/api/maquinas/${ajena}`).set(auth(admin.token, 'centro'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/maquinas/:id/detener-ciclo — permiso por tipo', () => {
  it('un empleado NO puede detener una lavadora (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/administrador/i);
  });

  it('un empleado SÍ puede detener una secadora (200)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).patch(`/api/maquinas/${sec}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(200);
  });

  it('un admin SÍ puede detener una lavadora (200)', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(admin.token));
    expect(res.status).toBe(200);
  });
});

// Flujo de mostrador: el empleado levanta la nota y arranca la lavadora en
// Salidas; si algo sale mal (carga mal puesta, cliente que se arrepiente), el
// admin tiene que poder detenerla desde SU cuenta, sin depender del empleado.
describe('el admin detiene una lavadora que arrancó un empleado', () => {
  const estadoMaquina = async (id) =>
    (await pool.query('SELECT estado, en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];
  const estadoNota = async (id) =>
    (await pool.query('SELECT estado FROM notas WHERE id = $1', [id])).rows[0].estado;

  // El empleado crea la nota, le asigna la lavadora (Salidas) y la arranca.
  async function empleadoArranca(tipo_servicio, nombreMaquina) {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_chico: 150 });
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: `Emp${nombreMaquina}` });
    const lavadoraId = await seedMaquina({ nombre: nombreMaquina, tipo: 'lavadora_mediana' });
    const cuerpo = {
      tipo_servicio, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [tipo_servicio === 'POR_ENCARGO'
        ? { lavadora_tipo: 'mediana', tamano: 'chico' }
        : { lavadora_tipo: 'mediana' }],
      ...(tipo_servicio === 'POR_ENCARGO' ? { cliente_id: await seedCliente() } : {}),
    };
    const creada = await request(app).post('/api/notas').set(auth(empleado.token)).send(cuerpo);
    expect(creada.status).toBe(201);
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(empleado.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(empleado.token))
      .send({ maquina_id: lavadoraId }).expect(200);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
    return { notaId: creada.body.id, lavadoraId, empleado };
  }

  for (const servicio of ['AUTOSERVICIO', 'POR_ENCARGO']) {
    it(`${servicio}: el admin la detiene y la nota vuelve a En Espera`, async () => {
      const { notaId, lavadoraId } = await empleadoArranca(servicio, `L-${servicio}`);

      await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`)
        .set(auth(admin.token)).expect(200);

      const m = await estadoMaquina(lavadoraId);
      expect(m.estado).toBe('disponible');
      expect(m.en_uso_desde).toBeNull();   // el temporizador se reinicia
      expect(await estadoNota(notaId)).toBe('EN_ESPERA');
    });
  }

  it('tras detenerla, el empleado puede volver a arrancarla', async () => {
    const { notaId, lavadoraId, empleado } = await empleadoArranca('AUTOSERVICIO', 'L-reinicio');
    await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`).set(auth(admin.token)).expect(200);

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(empleado.token))
      .send({ maquina_id: lavadoraId }).expect(200);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
  });

  it('un admin parado en otra sucursal no la toca (404) y la máquina sigue corriendo', async () => {
    await seedSucursal('norte', 'Norte');
    const { lavadoraId } = await empleadoArranca('AUTOSERVICIO', 'L-otra-suc');

    const res = await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`)
      .set(auth(admin.token, 'norte'));
    expect(res.status).toBe(404);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
  });
});
