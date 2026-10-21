// Lo vendido hoy (Inventario del empleado): por producto, cuánto y en qué
// notas; sin las canceladas ni lo de otros días u otras sucursales.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente, auth,
} from '../helpers.js';

let empleado;
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({ tope_carga_grande: 100 });
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Emp' });
});

/** Nota Por Encargo con una pieza del producto. */
const notaCon = async (productoId, cantidad = 1) => {
  const clienteId = await seedCliente();
  const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
    estado_pago: 'PENDIENTE',
    cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
               productos: [{ producto_id: productoId, cantidad }] }],
  });
  expect(res.status).toBe(201);
  return res.body;
};

describe('GET /api/productos/vendidos-hoy', () => {
  it('suma por producto y dice en qué notas, también para el empleado', async () => {
    const polvo = await seedProducto({
      nombre: 'Jabón', tipo_liquido: 'granel', forma: 'polvo',
      botella_ml: 1, medida_ml: 1, precio_unitario: null, precio_botella: 15, stock_actual: 10,
    });
    const a = await notaCon(polvo, 1);
    const b = await notaCon(polvo, 2);

    const res = await request(app).get('/api/productos/vendidos-hoy').set(auth(empleado.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].cantidad).toBe(3);
    expect(res.body[0].notas.map(n => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('deja fuera las canceladas y lo de días anteriores', async () => {
    const polvo = await seedProducto({
      nombre: 'Jabón', tipo_liquido: 'granel', forma: 'polvo',
      botella_ml: 1, medida_ml: 1, precio_unitario: null, precio_botella: 15, stock_actual: 10,
    });
    const cancelada = await notaCon(polvo);
    const ayer = await notaCon(polvo);
    await pool.query("UPDATE notas SET estado = 'CANCELADA' WHERE id = $1", [cancelada.id]);
    await pool.query("UPDATE nota_productos SET created_at = now() - interval '2 days' WHERE nota_id = $1", [ayer.id]);

    const res = await request(app).get('/api/productos/vendidos-hoy').set(auth(empleado.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
