// Agregar a una nota un producto que ya lleva NO abre otro renglón: le suma la
// cantidad al que ya existe (lo usa "Agregar productos" de la pantalla Salidas).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes();
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

// Nota de Autoservicio con una carga y sin productos.
async function crearNota() {
  const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO',
    tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE',
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

const renglones = (notaId) =>
  pool.query('SELECT * FROM nota_productos WHERE nota_id = $1 ORDER BY id', [notaId])
      .then(r => r.rows);

describe('POST /api/notas/:id/productos — agregar dos veces el mismo producto', () => {
  it('suma la cantidad en el renglón que ya existe', async () => {
    // 800 ml de botella / 200 de tapa = 4 tapas por botella.
    const jabon = await seedProducto({
      nombre: 'Jabón', precio_unitario: 5, precio_botella: 27, stock_actual: 40,
    });
    const notaId = await crearNota();

    const r1 = await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: jabon, cantidad: 1 });
    expect(r1.status).toBe(201);

    const r2 = await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: jabon, cantidad: 2 });
    expect(r2.status).toBe(201);

    const filas = await renglones(notaId);
    expect(filas).toHaveLength(1);                    // un solo renglón
    expect(Number(filas[0].cantidad)).toBe(3);        // 1 + 2 botellas
    expect(Number(filas[0].cantidad_tapas)).toBe(12); // 3 botellas × 4 tapas
    expect(Number(filas[0].precio_unitario)).toBe(27);

    // El stock reservado acumula las dos veces.
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [jabon]);
    expect(Number(rows[0].stock_reservado)).toBe(12);
  });

  it('no deja pedir más de lo que hay entre las dos veces', async () => {
    // 8 tapas = 2 botellas exactas.
    const jabon = await seedProducto({
      nombre: 'Jabón', precio_unitario: 5, precio_botella: 27, stock_actual: 8,
    });
    const notaId = await crearNota();

    await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: jabon, cantidad: 2 });

    const res = await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: jabon, cantidad: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no hay suficiente/i);

    const filas = await renglones(notaId);
    expect(filas).toHaveLength(1);
    expect(Number(filas[0].cantidad)).toBe(2);        // no cambió
  });

  it('productos distintos siguen en renglones distintos', async () => {
    const jabon = await seedProducto({ nombre: 'Jabón', precio_botella: 27, stock_actual: 40 });
    const suave = await seedProducto({ nombre: 'Suavizante', precio_botella: 20, stock_actual: 40 });
    const notaId = await crearNota();

    await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: jabon, cantidad: 1 });
    await request(app).post(`/api/notas/${notaId}/productos`)
      .set(auth(admin.token)).send({ producto_id: suave, cantidad: 1 });

    expect(await renglones(notaId)).toHaveLength(2);
  });
});
