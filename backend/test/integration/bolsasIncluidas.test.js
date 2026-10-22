// Mig. 166: en Por Encargo cada servicio incluye las bolsas de Ajustes
// (Servicio Chico → Bolsas: 1); las de más se cobran a su precio. Las notas de
// antes siguen con todas incluidas.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { recalcularPrecioTotal } from '../../controllers/notas.controller.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedAjustes, seedEtiquetas, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedEtiquetas('tamanos_bolsa', ['Chica', 'Grande', 'Jumbo']);
  // Chico: $120 con 1 bolsa incluida.
  await seedAjustes({ precarga_bolsas_chico: 1 });
});

const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

/** Bolsa ligada al servicio Chico, $5 la pieza, con 100 en existencia. */
async function bolsaChico() {
  const { body } = await api('post', '/api/productos', {
    clase: 'bolsa', nombre: 'Bolsa SPE', tamano_bolsa: 'chica', bolsas_por_rollo: 100,
    precio_unitario: 5, servicios_bolsa: ['chico'],
  });
  await api('post', `/api/productos/${body.id}/movimiento`,
    { tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 1 }).expect(200);
  return body.id;
}

const notaChico = (bolsaId, bolsas, servicios = 1) => api('post', '/api/notas', {
  tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
  cargas: Array.from({ length: servicios }, () => ({ tamano: 'chico', tipo_prenda: 'ROPA' })),
  productos: [{ producto_id: bolsaId, cantidad: bolsas }],
});

const total = async (id) =>
  Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [id])).rows[0].precio_total);

describe('bolsas incluidas en Por Encargo', () => {
  it('la del servicio va incluida', async () => {
    const bolsa = await bolsaChico();
    const res = await notaChico(bolsa, 1);
    expect(res.status).toBe(201);
    expect(await total(res.body.id)).toBe(120);
    const { rows } = await pool.query(
      'SELECT bolsa_producto_id, bolsas_incluidas FROM nota_cargas WHERE nota_id = $1', [res.body.id]);
    expect(rows[0]).toEqual({ bolsa_producto_id: bolsa, bolsas_incluidas: 1 });
  });

  it('la de más se cobra', async () => {
    const bolsa = await bolsaChico();
    const { body } = await notaChico(bolsa, 2);
    expect(await total(body.id)).toBe(125);
  });

  it('agregada en Salidas también se cobra', async () => {
    const bolsa = await bolsaChico();
    const { body } = await notaChico(bolsa, 1);
    await api('post', `/api/notas/${body.id}/productos`, { producto_id: bolsa, cantidad: 1 }).expect(201);
    expect(await total(body.id)).toBe(125);
  });

  it('dos servicios Chico incluyen dos', async () => {
    const bolsa = await bolsaChico();
    const { body } = await notaChico(bolsa, 3, 2);
    expect(await total(body.id)).toBe(240 + 5);
  });

  it('las de más no gastan del precio del servicio', async () => {
    const bolsa = await bolsaChico();
    // 10 bolsas: antes, $50 de material contra el servicio; ahora solo la incluida.
    const res = await notaChico(bolsa, 10);
    expect(res.status).toBe(201);
    expect(await total(res.body.id)).toBe(120 + 45);
  });

  it('una nota de antes sigue con todas incluidas', async () => {
    const bolsa = await bolsaChico();
    const { body } = await notaChico(bolsa, 2);
    await pool.query('UPDATE notas SET bolsas_todas_incluidas = TRUE WHERE id = $1', [body.id]);
    await recalcularPrecioTotal(pool, body.id);
    expect(await total(body.id)).toBe(120);
  });
});

describe('la bolsa de más cuadra en caja y Ventas', () => {
  it('va a Productos; el servicio, a Por Encargo', async () => {
    await api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);
    const bolsa = await bolsaChico();
    const { body } = await notaChico(bolsa, 2);
    await api('patch', `/api/notas/${body.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const { totales } = (await api('get', '/api/caja/actual')).body;
    expect(totales.ingresos).toMatchObject({ por_encargo: 120, productos: 5 });

    const ventas = (await api('get', '/api/ventas/resumen?periodo=hoy')).body;
    expect(ventas.corte.total_productos).toBe(5);
    const nota = ventas.lista_notas.find(n => n.id === body.id);
    expect(Number(nota.total_productos)).toBe(5);
    expect(nota.productos[0]).toMatchObject({ cobrado: 5, incluido: false });
  });
});

describe('el tope del servicio sigue funcionando', () => {
  // Chico: $120; sus máquinas cuestan 70 + 45 = 115, así que caben $5 de material.
  const bolsaDe = async (precio) => {
    const { body } = await api('post', '/api/productos', {
      clase: 'bolsa', nombre: 'Bolsa SPE', tamano_bolsa: 'chica', bolsas_por_rollo: 100,
      precio_unitario: precio, servicios_bolsa: ['chico'],
    });
    await api('post', `/api/productos/${body.id}/movimiento`,
      { tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 1 }).expect(200);
    return body.id;
  };

  it('la bolsa incluida sí gasta del precio del servicio: si no cabe, no se crea', async () => {
    const cara = await bolsaDe(10); // 115 + 10 = 125 > 120
    const res = await notaChico(cara, 1);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/material de la nota/i);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM notas');
    expect(rows[0].n).toBe(0);
  });

  it('la bolsa incluida que cabe se queda en el precio del servicio', async () => {
    const justa = await bolsaDe(5); // 115 + 5 = 120
    const res = await notaChico(justa, 1);
    expect(res.status).toBe(201);
    expect(await total(res.body.id)).toBe(120);
  });

  it('el granel que se pasa en Salidas se rechaza y el total no cambia', async () => {
    const bolsa = await bolsaDe(5);
    const { body } = await notaChico(bolsa, 1);
    const { rows: [{ id: jabon }] } = await pool.query(
      `INSERT INTO productos (nombre, precio_unitario, stock_actual, stock_reservado, es_por_medida,
                              tipo_liquido, forma, botella_ml, medida_ml, sucursal)
       VALUES ('Jabón', 8, 100, 0, TRUE, 'granel', 'liquido', 800, 200, 'centro') RETURNING id`);
    const res = await api('post', `/api/notas/${body.id}/productos`, { producto_id: jabon, cantidad: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/material de la nota/i);
    expect(await total(body.id)).toBe(120);
  });

  it('lo que se cobra aparte (bolsas de más) no cuenta contra el tope', async () => {
    const bolsa = await bolsaDe(5);
    const res = await notaChico(bolsa, 4); // 1 incluida + 3 de más
    expect(res.status).toBe(201);
    expect(await total(res.body.id)).toBe(120 + 15);
  });
});
