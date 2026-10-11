// Folio por sucursal (mig. 155): cada sucursal lleva su propio consecutivo, así
// que dos sucursales pueden tener el mismo número y un alta de una no mueve el
// folio de la otra.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedAjustes, seedProducto, auth } from '../helpers.js';

let centro;
let norte;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedSucursal('norte', 'Norte');
  await seedAjustes({});
  centro = await seedUsuario({ rol: 'operador', sucursal: 'centro' });
  norte = await seedUsuario({ rol: 'operador', sucursal: 'norte' });
});

const venta = async (u, sucursal) => {
  const jabon = await seedProducto({ nombre: `Jabón ${Math.random()}`, precio_unitario: 5, precio_botella: 27, sucursal });
  const res = await request(app).post('/api/notas').set(auth(u.token)).send({
    tipo_servicio: 'PRODUCTOS', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    productos: [{ producto_id: jabon, cantidad: 1 }],
  });
  expect(res.status).toBe(201);
  return res.body.folio.split('-')[0];
};

describe('folio por sucursal', () => {
  it('cada sucursal cuenta por su lado y pueden repetir número', async () => {
    expect(await venta(centro, 'centro')).toBe('0001');
    expect(await venta(centro, 'centro')).toBe('0002');
    expect(await venta(norte, 'norte')).toBe('0001');
    expect(await venta(centro, 'centro')).toBe('0003');
  });

  it('next-folio anuncia el de su sucursal', async () => {
    await venta(centro, 'centro');
    const c = await request(app).get('/api/notas/next-folio').set(auth(centro.token));
    const n = await request(app).get('/api/notas/next-folio').set(auth(norte.token));
    expect(c.body.folio.split('-')[0]).toBe('0002');
    expect(n.body.folio.split('-')[0]).toBe('0001');
  });

  it('un alta que falla no gasta número', async () => {
    const mal = await request(app).post('/api/notas').set(auth(centro.token)).send({
      tipo_servicio: 'PRODUCTOS', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      productos: [{ producto_id: 999999, cantidad: 1 }],
    });
    expect(mal.status).toBeGreaterThanOrEqual(400);
    expect(await venta(centro, 'centro')).toBe('0001');
    const { rows } = await pool.query("SELECT ultimo FROM folios_sucursal WHERE sucursal = 'centro'");
    expect(rows[0].ultimo).toBe(1);
  });
});
