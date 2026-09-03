import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedCliente, seedProducto, auth } from '../helpers.js';
import pool from '../../db/pool.js';

// Ventas deriva las cargas y el total desde nota_cargas (ya no de las columnas
// denormalizadas de la nota). Este smoke test ejerce ambas consultas (lista y
// corte) para atrapar cualquier referencia a columnas eliminadas.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/ventas/resumen', () => {
  it('responde con la estructura esperada y cuenta las cargas por nota', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(creada.status).toBe(201);
    // Asignar la lavadora física y arrancarla para que la venta la refleje.
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });

    const res = await request(app)
      .get('/api/ventas/resumen?periodo=hoy')
      .set(auth(admin.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tarjetas');
    expect(res.body).toHaveProperty('corte');
    expect(Array.isArray(res.body.lista_notas)).toBe(true);
    expect(res.body.lista_notas).toHaveLength(1);
    expect(res.body.lista_notas[0].cargas).toBe(1);
    expect(res.body.lista_notas[0].maquinas).toEqual([{ nombre: 'Lavadora 1', cargas: 1 }]);
  });

  it('requiere rol admin (un operador recibe 403)', async () => {
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(operador.token));
    expect(res.status).toBe(403);
  });
});

// Crea una nota de autoservicio con una lavadora mediana (tarifa default 70)
// y devuelve su respuesta. `nombreMaquina` debe ser único por nota (cada una
// toma su propia máquina disponible).
async function crearNota(token, { nombreMaquina, estado_pago = 'PENDIENTE', ajuste = 0, productos, sucursal = 'centro' } = {}) {
  const lavadoraId = await seedMaquina({ nombre: nombreMaquina, tipo: 'lavadora_mediana', sucursal });
  const body = {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago, ajuste,
    cargas: [{ lavadora_tipo: 'mediana' }],
  };
  if (productos) body.productos = productos;
  const creada = await request(app).post('/api/notas').set(auth(token, sucursal)).send(body);
  // Asigna la lavadora física y la arranca (Salidas): la venta refleja la máquina.
  if (creada.status === 201) {
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(token, sucursal))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(token, sucursal))
      .send({ maquina_id: lavadoraId });
  }
  return creada;
}

describe('GET /api/ventas/resumen — tarjetas y período', () => {
  it('total_cobrado solo cuenta las pagadas; las pendientes van a notas_pendientes y a la lista', async () => {
    await crearNota(admin.token, { nombreMaquina: 'L1', estado_pago: 'PAGADO' });   // 70, cuenta
    await crearNota(admin.token, { nombreMaquina: 'L2', estado_pago: 'PENDIENTE' }); // no cuenta al cobrado

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.tarjetas.total_cobrado).toBe(70);
    expect(res.body.tarjetas.notas_pagadas).toBe(1);
    expect(res.body.tarjetas.notas_pendientes).toBe(1);
    // La lista incluye TODAS las del período (pagadas o no).
    expect(res.body.lista_notas).toHaveLength(2);
  });

  it('el corte cuadra: total_general = cargas + productos + ajustes', async () => {
    await crearNota(admin.token, {
      nombreMaquina: 'L1', estado_pago: 'PAGADO', ajuste: 5,
      productos: [{ producto_id: await seedProducto({ precio_botella: 30 }), cantidad: 1 }],
    });

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.corte.total_cargas).toBe(70);
    expect(res.body.corte.total_productos).toBe(30);
    expect(res.body.corte.total_ajustes).toBe(5);
    expect(res.body.corte.total_general).toBe(105);
    expect(res.body.tarjetas.total_cobrado).toBe(105);
  });

  it('una nota cancelada no cuenta en los totales, pero sí aparece en la lista', async () => {
    const creada = await crearNota(admin.token, { nombreMaquina: 'L1', estado_pago: 'PAGADO' });
    // Una nota cobrada ya no se puede cancelar de frente: primero se revierte
    // el pago (así el dinero devuelto queda registrado) y luego se cancela.
    await request(app).patch(`/api/notas/${creada.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE' }).expect(200);
    await request(app).patch(`/api/notas/${creada.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA' }).expect(200);

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    // No cuenta en los totales…
    expect(res.body.tarjetas.total_cobrado).toBe(0);
    expect(res.body.tarjetas.notas_pagadas).toBe(0);
    expect(res.body.corte.total_general).toBe(0);
    // …pero sí se muestra en la lista, con su estado.
    expect(res.body.lista_notas).toHaveLength(1);
    expect(res.body.lista_notas[0].estado).toBe('CANCELADA');
  });

  it('aísla por sucursal', async () => {
    await seedSucursal('norte', 'Norte');
    const adminNorte = await seedUsuario({ rol: 'admin', sucursal: 'norte', nombre: 'AdminNorte' });
    await crearNota(admin.token, { nombreMaquina: 'L1', estado_pago: 'PAGADO', sucursal: 'centro' });
    await crearNota(adminNorte.token, { nombreMaquina: 'N1', estado_pago: 'PAGADO', sucursal: 'norte' });

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token, 'centro'));
    expect(res.body.tarjetas.total_cobrado).toBe(70); // solo centro
    expect(res.body.lista_notas).toHaveLength(1);
  });

  // Regresión: el "día" del reporte es el del NEGOCIO (America/Mexico_City), no
  // el del servidor de base de datos, que en producción corre en UTC. Una nota
  // cobrada hoy a las 23:30 hora de México ya es "mañana" en UTC, y el criterio
  // viejo (DATE(pagado_en) = CURRENT_DATE) la dejaba fuera del reporte de hoy.
  it('cuenta en HOY un cobro de la noche, aunque en UTC ya sea el día siguiente', async () => {
    const creada = await crearNota(admin.token, { nombreMaquina: 'L1', estado_pago: 'PAGADO' });
    // Mueve el cobro a las 23:30 de hoy, hora del negocio.
    await pool.query(
      `UPDATE notas
          SET pagado_en = (date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City')
                           + INTERVAL '23 hours 30 minutes') AT TIME ZONE 'America/Mexico_City'
        WHERE id = $1`,
      [creada.body.id]
    );

    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.tarjetas.total_cobrado).toBe(70);
    expect(res.body.tarjetas.notas_pagadas).toBe(1);
    // La gráfica lo agrupa en el día local del negocio, como texto YYYY-MM-DD.
    const hoyNegocio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    expect(res.body.grafica.map(g => g.fecha)).toContain(hoyNegocio);
  });

  it('período custom sin desde/hasta → 400', async () => {
    const res = await request(app).get('/api/ventas/resumen?periodo=custom').set(auth(admin.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/desde y hasta/i);
  });
});

describe('GET /api/ventas/anios', () => {
  it('devuelve los años con notas (excluye canceladas) y requiere admin', async () => {
    await crearNota(admin.token, { nombreMaquina: 'L1', estado_pago: 'PAGADO' });
    const res = await request(app).get('/api/ventas/anios').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toContain(new Date().getFullYear());

    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const forbidden = await request(app).get('/api/ventas/anios').set(auth(operador.token));
    expect(forbidden.status).toBe(403);
  });
});
