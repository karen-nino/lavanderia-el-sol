// Recuadros Ingresos y Egresos del corte (2026-10-10). Ingresos: de dónde salió
// el efectivo del turno — lavadoras medianas, jumbo, secadoras, productos, Por
// Encargo y Edredón; solo efectivo, y la suma es la de ventas en efectivo.
// Egresos: lo que el turno dejó por cobrar en Por Encargo y las salidas.
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

  it('egresos: saldo de los Por Encargo del turno sin liquidar, y las salidas', async () => {
    const cli = await seedCliente();
    const encargo = () => api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);                                                          // 70 c/u

    const conAbono = await encargo();
    await api('post', `/api/notas/${conAbono.body.id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
    await encargo();                                                         // debe 70
    const pagada = await encargo();
    await api('patch', `/api/notas/${pagada.body.id}/estado-pago`,
      { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);       // ya no debe
    const vieja = await encargo();                                           // de antes del turno
    await pool.query("UPDATE notas SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1", [vieja.body.id]);

    await api('post', '/api/caja/movimientos', { tipo: 'salida', concepto: 'Gas', monto: 45 }).expect(201);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.egresos).toEqual({ por_encargo_pendiente: 110, salidas: 45 }); // 40 + 70
  });

  it('al cerrar se congelan los ingresos y el SPE Debe, y Ventas trae el turno', async () => {
    await autoservicio({ tipo: 'lavadora_mediana' });                        // 70 efectivo
    const cli = await seedCliente();
    const encargo = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);                                                          // debe 70

    await api('post', '/api/caja/cerrar', { monto_contado: 270, monto_caja_final: 270, monto_sobre: 0 }).expect(200);
    // Pagarla DESPUÉS del corte no cambia lo que el corte dice que se debía.
    await api('post', '/api/caja/abrir', { monto_inicial: 270 }).expect(201);
    await api('patch', `/api/notas/${encargo.body.id}/estado-pago`,
      { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const historial = (await api('get', '/api/caja/historial')).body;
    expect(historial).toHaveLength(1);
    expect(historial[0].ingresos).toMatchObject({ lavadoras_medianas: 70, por_encargo: 0 });
    expect(historial[0].spe_debe).toBe(70);

    const ventas = (await api('get', '/api/ventas/resumen?periodo=hoy')).body;
    expect(ventas.turnos).toHaveLength(2);
    const [cerrado, abierto] = ventas.turnos;
    expect(cerrado).toMatchObject({ en_curso: false, spe_debe: 70, esperado: 270 });
    expect(abierto).toMatchObject({ en_curso: true, spe_debe: 0, monto_inicial: 270 });
    expect(abierto.ingresos.por_encargo).toBe(70);
  });

  it('Ventas reparte por concepto TODOS los cobros del período (también transferencia)', async () => {
    await autoservicio({ tipo: 'lavadora_mediana', secadora: true });              // 70 + 50
    await autoservicio({ tipo: 'lavadora_jumbo', forma_pago: 'TRANSFERENCIA' });   // 90
    const cli = await seedCliente();
    const encargo = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    await api('post', `/api/notas/${encargo.body.id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);

    const { corte } = (await api('get', '/api/ventas/resumen?periodo=hoy')).body;
    expect(corte.conceptos).toEqual({
      lavadoras_medianas: 70, lavadoras_jumbo: 90, secadoras: 50, productos: 0, por_encargo: 30, edredon: 0,
    });
    const suma = Object.values(corte.conceptos).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(corte.total_cobrado, 2);
  });

  it('el edredón de autoservicio cuenta como jumbo aunque entre en una mediana', async () => {
    await seedAjustes({ precio_carga_mediana: 70, precio_carga_jumbo: 90, precio_edredon_jumbo: 80 });
    const nota = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'EDREDON', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'jumbo', tipo_prenda: 'EDREDON' }],
    }).expect(201);
    const mediana = await seedMaquina({ nombre: 'L-med', tipo: 'lavadora_mediana' });
    await api('patch', `/api/notas/${nota.body.id}/asignar-carga-maquina`,
      { carga_id: nota.body.cargas[0].id, slot: 'lavadora', maquina_id: mediana }).expect(200);
    await api('patch', `/api/notas/${nota.body.id}/estado-pago`,
      { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.ingresos).toMatchObject({ lavadoras_jumbo: 80, lavadoras_medianas: 0 });
  });

  it('en Por Encargo, el producto de marca cobrado aparte va a Productos, no a SPE', async () => {
    const marca = await seedProducto({ nombre: 'ARIEL', precio_unitario: 25, precio_botella: 25, tipo_liquido: 'marca' });
    const cli = await seedCliente();
    const nota = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);                                                           // servicio 70
    await api('post', `/api/notas/${nota.body.id}/productos`, { producto_id: marca, cantidad: 1 }).expect(201);
    const total = Number((await api('get', `/api/notas/${nota.body.id}`)).body.precio_total);
    await api('patch', `/api/notas/${nota.body.id}/estado-pago`,
      { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.ingresos.por_encargo).toBe(70);
    expect(totales.ingresos.productos).toBe(total - 70);
    expect(totales.ingresos.productos).toBeGreaterThan(0);
  });
});

