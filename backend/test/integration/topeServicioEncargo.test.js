// Tope de cada servicio Por Encargo: lo que gasta (máquinas + material servido)
// no puede pasar de su precio. Si el empleado sube las medidas de granel o mete
// material de más, la nota no se crea (o el cambio no se guarda en Salidas).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, auth } from '../helpers.js';

let admin;
let jabonTipo;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // Chico: $120 con 1 medida de jabón; sus máquinas cuestan 70 + 45 = 115.
  await seedAjustes({ precarga_medidas_chico: 1 });
  const { rows } = await pool.query(`INSERT INTO tipos_granel (nombre, orden) VALUES ('Jabón', 1) RETURNING id`);
  jabonTipo = rows[0].id;
});

const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

/** Jabón a granel del tipo Jabón, a `precio` la medida. */
async function jabon(precio) {
  const id = await seedProducto({ nombre: 'OXXI', precio_unitario: precio, stock_actual: 100 });
  await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [id, jabonTipo]);
  return id;
}

const notaChico = (medidas) => api('post', '/api/notas', {
  tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
  cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA',
    ...(medidas != null && { granel: [{ tipo_granel_id: jabonTipo, cantidad: medidas }] }) }],
});
const notas = async () => (await pool.query('SELECT COUNT(*)::int AS n FROM notas')).rows[0].n;

describe('medidas de granel de más', () => {
  it('las incluidas que caben: se crea a $120', async () => {
    await jabon(5); // 115 + 5 = 120
    const res = await notaChico();
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(120);
  });

  it('subirlas al crear la nota hasta pasar el tope: no se crea', async () => {
    await jabon(5); // 115 + 3 × 5 = 130 > 120
    const res = await notaChico(3);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/se cobra en \$120/);
    expect(await notas()).toBe(0);
  });

  it('subirlas en Salidas hasta pasar el tope: no se guarda', async () => {
    await jabon(5);
    const { body: nota } = await notaChico();
    const carga = nota.cargas[0];
    const res = await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: (await pool.query("SELECT id FROM productos WHERE nombre = 'OXXI'")).rows[0].id, cantidad: 3 });
    expect(res.status).toBe(400);
    const { rows } = await pool.query(
      'SELECT SUM(cantidad)::int AS medidas FROM nota_productos WHERE carga_id = $1', [carga.id]);
    expect(rows[0].medidas).toBe(1);
  });
});

describe('granel aún sin producto (varios del mismo tipo)', () => {
  // Dos jabones: el producto se elige en Salidas. Mientras, cuenta el más caro.
  beforeEach(async () => {
    await jabon(2);
    const caro = await seedProducto({ nombre: 'PERSIL', precio_unitario: 5, stock_actual: 100 });
    await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [caro, jabonTipo]);
  });

  it('cabe con el más caro: se crea', async () => {
    const res = await notaChico(1); // 115 + 1 × 5 = 120
    expect(res.status).toBe(201);
  });

  it('con el más caro se pasa: no se crea, aunque con el barato cupiera', async () => {
    const res = await notaChico(2); // 115 + 2 × 5 = 125 > 120 (con el de $2 serían 119)
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/se cobra en \$120/);
    expect(await notas()).toBe(0);
  });

  it('el que trae el cliente no gasta del tope', async () => {
    const { body: nota } = await notaChico(1);
    const carga = nota.cargas[0];
    const res = await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { del_cliente: true, cantidad: 10 });
    expect(res.status).toBe(200);
  });
});
