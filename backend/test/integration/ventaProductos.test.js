// Venta de mostrador (tipo de servicio PRODUCTOS, mig. 112): productos sueltos,
// sin lavado ni secado. Es la única nota que nace FINALIZADA, así que lo que se
// fija aquí es justo lo que la distingue: que no lleva cargas, que se cobra en
// el acto y que el inventario se mueve en ese mismo momento.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedCliente, seedAjustes, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes();
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

// Producto de marca que se vende por botella: 800/200 = 4 tapas por botella.
const seedJabon = (stock_actual = 40) =>
  seedProducto({ nombre: 'Jabón', precio_unitario: 5, precio_botella: 27, stock_actual });

const venta = (body = {}) =>
  request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'PRODUCTOS',
    estado_pago: 'PAGADO',
    forma_pago: 'EFECTIVO',
    ...body,
  });

describe('POST /api/notas — venta de Productos', () => {
  it('se cobra por botella, nace finalizada y descuenta el inventario en el acto', async () => {
    const jabon = await seedJabon();

    const res = await venta({ productos: [{ producto_id: jabon, cantidad: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('PRODUCTOS');
    expect(res.body.estado).toBe('FINALIZADA');
    expect(res.body.estado_pago).toBe('PAGADO');
    expect(res.body.forma_pago).toBe('EFECTIVO');
    expect(res.body.cargas).toEqual([]);
    expect(Number(res.body.precio_total)).toBe(54); // 2 botellas × $27
    expect(res.body.folio).toBeTruthy();

    // El renglón va a nivel nota (sin carga) y en botellas, no en tapas.
    const { rows: prods } = await pool.query(
      'SELECT * FROM nota_productos WHERE nota_id = $1', [res.body.id]
    );
    expect(prods).toHaveLength(1);
    expect(prods[0].carga_id).toBeNull();
    expect(prods[0].unidad).toBe('botella');
    expect(Number(prods[0].cantidad)).toBe(2);
    expect(Number(prods[0].cantidad_tapas)).toBe(8);

    // El producto salió del estante ya: ni una tapa queda reservada.
    const { rows: stock } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [jabon]
    );
    expect(Number(stock[0].stock_actual)).toBe(32);
    expect(Number(stock[0].stock_reservado)).toBe(0);

    // Y queda en el historial de inventario como venta.
    const { rows: movs } = await pool.query(
      'SELECT tipo, cantidad_tapas FROM producto_movimientos WHERE nota_id = $1', [res.body.id]
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('venta');
    expect(Number(movs[0].cantidad_tapas)).toBe(8);
  });

  it('el ajuste descuenta del total', async () => {
    const jabon = await seedJabon();
    const res = await venta({ productos: [{ producto_id: jabon, cantidad: 2 }], ajuste: -4 });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(50);
  });

  it('el cliente es opcional, pero se guarda si se manda', async () => {
    const jabon = await seedJabon();
    const cliente = await seedCliente({ nombre: 'Ana' });

    const conCliente = await venta({
      cliente_id: cliente, productos: [{ producto_id: jabon, cantidad: 1 }],
    });
    expect(conCliente.status).toBe(201);
    expect(conCliente.body.cliente_id).toBe(cliente);

    const sinCliente = await venta({ productos: [{ producto_id: jabon, cantidad: 1 }] });
    expect(sinCliente.status).toBe(201);
    expect(sinCliente.body.cliente_id).toBeNull();
  });

  it('sin productos no hay venta', async () => {
    const res = await venta({ productos: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/al menos un producto/i);
  });

  it('no admite cargas: no hay lavado ni secado que cobrar', async () => {
    const jabon = await seedJabon();
    const res = await venta({
      productos: [{ producto_id: jabon, cantidad: 1 }],
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no lleva cargas/i);
  });

  it('no se puede dejar a deber ni cobrar sin decir cómo', async () => {
    const jabon = await seedJabon();
    const productos = [{ producto_id: jabon, cantidad: 1 }];

    const aDeber = await venta({ productos, estado_pago: 'PENDIENTE', forma_pago: null });
    expect(aDeber.status).toBe(400);
    expect(aDeber.body.message).toMatch(/forma de pago/i);

    const sinForma = await venta({ productos, forma_pago: null });
    expect(sinForma.status).toBe(400);
    expect(sinForma.body.message).toMatch(/forma de pago/i);

    // Y no dejó rastro: ni nota ni stock movido.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM notas');
    expect(rows[0].n).toBe(0);
    const { rows: stock } = await pool.query('SELECT stock_actual FROM productos WHERE id = $1', [jabon]);
    expect(Number(stock[0].stock_actual)).toBe(40);
  });

  it('no se vende más de lo que hay', async () => {
    const jabon = await seedJabon(4); // una sola botella
    const res = await venta({ productos: [{ producto_id: jabon, cantidad: 2 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no hay suficiente/i);
  });

  // Nace finalizada, así que no se puede cancelar: eliminarla es la única forma
  // de deshacer una venta mal capturada, y tiene que devolver el producto.
  it('al eliminarla, el producto vuelve al estante', async () => {
    const jabon = await seedJabon();
    const res = await venta({ productos: [{ producto_id: jabon, cantidad: 2 }] });
    expect(res.status).toBe(201);

    const del = await request(app).delete(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(del.status).toBe(204);

    const { rows } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [jabon]
    );
    expect(Number(rows[0].stock_actual)).toBe(40);
    expect(Number(rows[0].stock_reservado)).toBe(0);
  });

  it('una venta no se edita: ya está finalizada', async () => {
    const jabon = await seedJabon();
    const res = await venta({ productos: [{ producto_id: jabon, cantidad: 1 }] });

    const patch = await request(app).patch(`/api/notas/${res.body.id}`)
      .set(auth(admin.token)).send({ ajuste: -5 });
    expect(patch.status).toBe(400);
    expect(patch.body.message).toMatch(/finalizada/i);
  });
});
