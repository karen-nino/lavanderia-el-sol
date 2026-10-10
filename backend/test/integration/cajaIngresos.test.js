// Recuadro Ingresos del corte (2026-10-10): de dónde salió el efectivo del
// turno — lavadoras medianas, jumbo, secadoras, productos y Por Encargo. Solo
// cuenta el efectivo y la suma de las líneas es la de ventas en efectivo.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedAjustes, seedCliente, seedProducto, auth,
} from '../helpers.js';

let admin;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ precio_carga_mediana: 70, precio_carga_jumbo: 90, precio_carga_secadora: 50 });
  await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 200 }).expect(201);
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

// Nota de autoservicio con una lavadora (y opcionalmente secadora), cobrada.
async function autoservicio({ tipo, secadora = false, forma_pago = 'EFECTIVO' }) {
  const nota = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{
      lavadora_tipo: tipo === 'lavadora_jumbo' ? 'jumbo' : 'mediana',
      ...(secadora ? { secadora_tipo: 'mediana' } : {}),
    }],
  }).expect(201);
  const carga = nota.body.cargas[0].id;
  const lav = await seedMaquina({ nombre: `L-${Math.random()}`, tipo });
  await api('patch', `/api/notas/${nota.body.id}/asignar-carga-maquina`,
    { carga_id: carga, slot: 'lavadora', maquina_id: lav }).expect(200);
  if (secadora) {
    const sec = await seedMaquina({ nombre: `S-${Math.random()}`, tipo: 'secadora' });
    await api('patch', `/api/notas/${nota.body.id}/asignar-carga-maquina`,
      { carga_id: carga, slot: 'secadora', maquina_id: sec }).expect(200);
  }
  await api('patch', `/api/notas/${nota.body.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago }).expect(200);
}

describe('GET /api/caja/actual — ingresos', () => {
  it('reparte el efectivo por tipo de máquina, productos y Por Encargo', async () => {
    await autoservicio({ tipo: 'lavadora_mediana', secadora: true });      // 70 + 50
    await autoservicio({ tipo: 'lavadora_jumbo' });                         // 90
    await autoservicio({ tipo: 'lavadora_mediana', forma_pago: 'TRANSFERENCIA' }); // no es efectivo

    const jabon = await seedProducto({ nombre: 'Jabón', precio_unitario: 5, precio_botella: 27, stock_actual: 40 });
    await api('post', '/api/notas', {
      tipo_servicio: 'PRODUCTOS', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      productos: [{ producto_id: jabon, cantidad: 1 }],
    }).expect(201);                                                         // 27

    const cli = await seedCliente();
    const encargo = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    await api('post', `/api/notas/${encargo.body.id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.ingresos).toEqual({
      lavadoras_medianas: 70, lavadoras_jumbo: 90, secadoras: 50, productos: 27, edredon: 0, por_encargo: 30,
    });
    const suma = Object.values(totales.ingresos).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(totales.ventas_desglose.efectivo, 2);
  });

  it('en Por Encargo, el edredón y el cubre colchón van a Edredón y lo demás a Por Encargo', async () => {
    await pool.query(
      `INSERT INTO tamanos_edredon (nombre, precio, orden) VALUES ('Cubre Colchón', 130, 1)
       ON CONFLICT (nombre) DO UPDATE SET precio = EXCLUDED.precio`
    );
    const cli = await seedCliente();
    const nota = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [
        { lavadora_tipo: 'mediana' },                                                // 70
        { tamano: 'jumbo', tipo_prenda: 'EDREDON', tamano_edredon: 'Cubre Colchón' }, // 130
      ],
    }).expect(201);
    expect(Number(nota.body.precio_total)).toBe(200);
    await api('patch', `/api/notas/${nota.body.id}/estado-pago`,
      { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.ingresos).toMatchObject({ edredon: 130, por_encargo: 70 });
  });
});
