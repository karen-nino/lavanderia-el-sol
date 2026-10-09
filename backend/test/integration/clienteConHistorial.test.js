// Un cliente con notas YA CERRADAS (finalizadas o canceladas): la base no deja
// borrarlo (notas.cliente_id es ON DELETE RESTRICT, y las notas son historia de
// ventas que no se borra). Se OCULTA: sale de la lista y sus notas conservan el
// nombre. Antes tronaba con 500 (2026-10-08).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedCliente, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

async function notaCerradaPara(clienteId, estado = 'CANCELADA') {
  const n = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
  }).expect(201);
  await pool.query('UPDATE notas SET estado = $1 WHERE id = $2', [estado, n.body.id]);
}

describe('cliente con historial', () => {
  it('borrar uno: responde con el motivo, no con un error 500', async () => {
    const id = await seedCliente();
    await notaCerradaPara(id, 'FINALIZADA');
    const res = await request(app).delete(`/api/clientes/${id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    // Ya no sale en la lista ni se puede abrir…
    const lista = await request(app).get('/api/clientes').set(auth(admin.token)).expect(200);
    expect(lista.body.map((c) => c.id)).not.toContain(id);
    await request(app).get(`/api/clientes/${id}`).set(auth(admin.token)).expect(404);
    // …pero sus notas siguen con su nombre.
    const { rows } = await pool.query(
      'SELECT c.nombre FROM notas n JOIN clientes c ON c.id = n.cliente_id WHERE n.cliente_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('sin ninguna nota se sigue borrando de verdad', async () => {
    const id = await seedCliente();
    await request(app).delete(`/api/clientes/${id}`).set(auth(admin.token)).expect(200);
    const { rows } = await pool.query('SELECT id FROM clientes WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('borrado múltiple: el que tiene historial no tumba a los demás', async () => {
    const libre = await seedCliente({ nombre: 'Libre' });
    const viejo = await seedCliente({ nombre: 'Viejo' });
    await notaCerradaPara(viejo);
    const res = await request(app).post('/api/clientes/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, viejo], confirmar: true });
    expect(res.status).toBe(200);
    expect(res.body.eliminados).toEqual([libre, viejo].sort((a, b) => a - b));
    const lista = await request(app).get('/api/clientes').set(auth(admin.token)).expect(200);
    expect(lista.body).toHaveLength(0);
  });

  it('no se le pueden hacer notas nuevas a un cliente oculto', async () => {
    const id = await seedCliente();
    await notaCerradaPara(id);
    await request(app).delete(`/api/clientes/${id}`).set(auth(admin.token)).expect(200);
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: id, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/se eliminó/);
  });
});
