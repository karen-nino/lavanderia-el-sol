import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, seedMaquina, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

// Crea una nota Por Encargo activa para un cliente (lo "ata" a una nota).
async function notaActivaPara(clienteId) {
  await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  }).expect(201);
}

describe('POST /api/clientes — validaciones', () => {
  it('crea un cliente en la sucursal activa', async () => {
    const res = await request(app).post('/api/clientes').set(auth(admin.token))
      .send({ nombre: 'Ana', apellido: 'López', telefono: '3312345678' });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Ana');
    expect(res.body.sucursal).toBe('centro');
  });

  it('sin nombre → 400', async () => {
    const res = await request(app).post('/api/clientes').set(auth(admin.token))
      .send({ apellido: 'López', telefono: '33' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nombre/i);
  });

  it('sin apellido → 400', async () => {
    const res = await request(app).post('/api/clientes').set(auth(admin.token))
      .send({ nombre: 'Ana', telefono: '33' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/apellido/i);
  });

  it('teléfono con letras → 400', async () => {
    const res = await request(app).post('/api/clientes').set(auth(admin.token))
      .send({ nombre: 'Ana', apellido: 'López', telefono: '33-abc' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/solo puede contener números/i);
  });

  it('sin teléfono → 400', async () => {
    const res = await request(app).post('/api/clientes').set(auth(admin.token))
      .send({ nombre: 'Ana', apellido: 'López' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/requerido/i);
  });
});

describe('GET /api/clientes — aislamiento por sucursal', () => {
  it('solo lista los clientes de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedCliente({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedCliente({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/clientes').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });

  it('getById de un cliente de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedCliente({ sucursal: 'norte' });
    const res = await request(app).get(`/api/clientes/${ajeno}`).set(auth(admin.token, 'centro'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clientes/:id', () => {
  it('actualiza el nombre', async () => {
    const id = await seedCliente({ nombre: 'Ana' });
    const res = await request(app).patch(`/api/clientes/${id}`).set(auth(admin.token))
      .send({ nombre: 'Ana María' });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Ana María');
  });

  it('rechaza un teléfono inválido', async () => {
    const id = await seedCliente();
    const res = await request(app).patch(`/api/clientes/${id}`).set(auth(admin.token))
      .send({ telefono: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/números/i);
  });
});

describe('DELETE /api/clientes/:id', () => {
  it('elimina un cliente sin notas', async () => {
    const id = await seedCliente();
    const res = await request(app).delete(`/api/clientes/${id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT id FROM clientes WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('un empleado no puede eliminar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedCliente();
    const res = await request(app).delete(`/api/clientes/${id}`).set(auth(empleado.token));
    expect(res.status).toBe(403);
  });

  it('no elimina un cliente con una nota activa', async () => {
    const clienteId = await seedCliente();
    await notaActivaPara(clienteId);
    const res = await request(app).delete(`/api/clientes/${clienteId}`).set(auth(admin.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/notas activas/i);
  });

  it('un cliente de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedCliente({ sucursal: 'norte' });
    const res = await request(app).delete(`/api/clientes/${ajeno}`).set(auth(admin.token, 'centro'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/clientes/eliminar-multiples', () => {
  it('dry-run separa bloqueados de eliminables; confirmar borra solo los libres', async () => {
    const libre   = await seedCliente({ nombre: 'Libre' });
    const conNota = await seedCliente({ nombre: 'ConNota' });
    await notaActivaPara(conNota);

    const dry = await request(app).post('/api/clientes/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, conNota], confirmar: false });
    expect(dry.status).toBe(200);
    expect(dry.body.eliminables).toContain(libre);
    expect(dry.body.bloqueados.map((b) => b.id)).toContain(conNota);

    const del = await request(app).post('/api/clientes/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, conNota], confirmar: true });
    expect(del.status).toBe(200);
    expect(del.body.eliminados).toEqual([libre]);
    // El bloqueado sigue existiendo, el libre no.
    const { rows } = await pool.query('SELECT id FROM clientes ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([conNota]);
  });

  it('solo admin (un empleado recibe 403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).post('/api/clientes/eliminar-multiples').set(auth(empleado.token))
      .send({ ids: [1], confirmar: false });
    expect(res.status).toBe(403);
  });
});
