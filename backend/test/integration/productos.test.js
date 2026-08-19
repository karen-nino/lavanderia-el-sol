import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedMaquina, seedCliente, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('POST /api/productos — validaciones', () => {
  it('crea un producto normal', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Detergente', precio_unitario: 30, stock_actual: 20 });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Detergente');
    expect(res.body.sucursal).toBe('centro');
    expect(res.body.archivado).toBe(false);
  });

  it('sin nombre → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ precio_unitario: 30 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nombre/i);
  });

  it('por tapa sin tapas_por_envase → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Suavizante', es_por_tapa: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tapas/i);
  });
});

describe('GET /api/productos — aislamiento y archivados', () => {
  it('solo lista los activos de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedProducto({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedProducto({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/productos').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });

  it('los archivados no salen en la lista normal, sí con ?archivados=1', async () => {
    const id = await seedProducto({ nombre: 'Viejo' });
    await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: true }).expect(200);

    const normal = await request(app).get('/api/productos').set(auth(admin.token));
    expect(normal.body.map((p) => p.id)).not.toContain(id);

    const archivados = await request(app).get('/api/productos?archivados=1').set(auth(admin.token));
    expect(archivados.body.map((p) => p.id)).toContain(id);
  });
});

describe('PATCH /api/productos/:id/archivar', () => {
  it('archiva y restaura un producto (solo admin)', async () => {
    const id = await seedProducto({ nombre: 'Detergente' });

    const arch = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: true });
    expect(arch.status).toBe(200);
    expect(arch.body.archivado).toBe(true);

    const rest = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: false });
    expect(rest.status).toBe(200);
    expect(rest.body.archivado).toBe(false);
  });

  it('un empleado no puede archivar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedProducto();
    const res = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(empleado.token))
      .send({ archivado: true });
    expect(res.status).toBe(403);
  });

  it('un producto de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedProducto({ sucursal: 'norte' });
    const res = await request(app).patch(`/api/productos/${ajeno}/archivar`).set(auth(admin.token, 'centro'))
      .send({ archivado: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE múltiple /api/productos/eliminar-multiples', () => {
  // Un producto usado en una nota (nota_productos) no se puede borrar; queda
  // bloqueado y se archiva en vez de eliminar (lo maneja la UI).
  async function productoUsadoEnNota() {
    const productoId = await seedProducto({ nombre: 'Usado' });
    const clienteId = await seedCliente();
    await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: productoId, cantidad: 1 }],
    }).expect(201);
    return productoId;
  }

  it('dry-run marca como bloqueado el usado en una nota y borra solo el libre', async () => {
    const libre = await seedProducto({ nombre: 'Libre' });
    const usado = await productoUsadoEnNota();

    const dry = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, usado], confirmar: false });
    expect(dry.status).toBe(200);
    expect(dry.body.eliminables).toContain(libre);
    expect(dry.body.bloqueados.map((b) => b.id)).toContain(usado);

    const del = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, usado], confirmar: true });
    expect(del.status).toBe(200);
    expect(del.body.eliminados).toEqual([libre]);
    // El usado sigue existiendo (para el historial de la nota).
    const { rows } = await pool.query('SELECT id FROM productos WHERE id = $1', [usado]);
    expect(rows).toHaveLength(1);
  });

  it('sin ids → 400', async () => {
    const res = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [], confirmar: false });
    expect(res.status).toBe(400);
  });

  it('solo admin (un empleado recibe 403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).post('/api/productos/eliminar-multiples').set(auth(empleado.token))
      .send({ ids: [1], confirmar: false });
    expect(res.status).toBe(403);
  });
});
