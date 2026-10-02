// El granel EN POLVO (mig. 126): mismo catálogo de nombres que el líquido, pero
// se vende por UNIDAD entera —no se sirve por medidas—, así que se comporta
// como un producto de marca: sin bidón, contado en unidades y cobrado encima
// del tope del servicio.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes();
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

const crearPolvo = (extra = {}) =>
  request(app).post('/api/productos').set(auth(admin.token)).send({
    clase: 'liquido', tipo_liquido: 'granel', forma: 'polvo',
    nombre: 'Jabón', precio_botella: 15, stock_minimo: 3, ...extra,
  });

describe('POST /api/productos — granel en polvo', () => {
  it('se da de alta sin bidón ni medida y se cuenta por unidades', async () => {
    const res = await crearPolvo();
    expect(res.status).toBe(201);
    expect(res.body.forma).toBe('polvo');
    expect(res.body.se_vende_por_unidad).toBe(true);
    // 1 unidad = 1 botella = 1 medida: el stock queda contado en unidades.
    expect(Number(res.body.botella_ml)).toBe(1);
    expect(Number(res.body.medida_ml)).toBe(1);
    expect(res.body.volumen_envase_ml).toBeNull();
    expect(Number(res.body.stock_actual)).toBe(0);
  });

  it('no pide el volumen del bidón (que el líquido sí exige)', async () => {
    const liquido = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'liquido', tipo_liquido: 'granel', nombre: 'Jabón',
      botella_ml: 800, medida_ml: 200, precio_botella: 27,
    });
    expect(liquido.status).toBe(400);
    expect(liquido.body.message).toMatch(/bidón/i);
    expect((await crearPolvo()).status).toBe(201);
  });

  it('no tiene existencia a granel ni se rellena', async () => {
    const id = (await crearPolvo()).body.id;

    const aGranel = await request(app).post(`/api/productos/${id}/movimiento`)
      .set(auth(admin.token)).send({ tipo: 'entrada', destino: 'granel', unidad: 'bidon', cantidad: 1 });
    expect(aGranel.status).toBe(400);

    const rellenar = await request(app).post(`/api/productos/${id}/rellenar`)
      .set(auth(admin.token)).send({ botellas: 1 });
    expect(rellenar.status).toBe(400);

    // La entrada normal sí: 5 unidades son 5 de existencia (1 unidad = 1 medida).
    const entrada = await request(app).post(`/api/productos/${id}/movimiento`)
      .set(auth(admin.token)).send({ tipo: 'entrada', destino: 'botellas', unidad: 'botella', cantidad: 5 });
    expect(entrada.status).toBe(200);
    const { rows } = await pool.query('SELECT stock_actual FROM productos WHERE id = $1', [id]);
    expect(Number(rows[0].stock_actual)).toBe(5);
  });
});

describe('POR ENCARGO — el polvo se cobra encima del tope', () => {
  it('suma su precio al servicio, como un producto de marca', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
    const clienteId = await seedCliente();
    const polvo = await seedProducto({
      nombre: 'Jabón', tipo_liquido: 'granel', forma: 'polvo',
      botella_ml: 1, medida_ml: 1, precio_unitario: null, precio_botella: 15, stock_actual: 10,
    });

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                 productos: [{ producto_id: polvo, cantidad: 1 }] }],
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(115); // tope 100 + 15 del polvo
    // Se vendió una unidad entera, no una medida.
    const { rows } = await pool.query(
      `SELECT np.unidad, np.cantidad, a.stock_reservado
         FROM nota_productos np JOIN productos a ON a.id = np.producto_id
        WHERE np.producto_id = $1`, [polvo]);
    expect(rows[0].unidad).toBe('botella');
    expect(Number(rows[0].stock_reservado)).toBe(1);
  });

  it('el granel líquido sigue contando DENTRO del tope', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
    const clienteId = await seedCliente();
    const liquido = await seedProducto({ nombre: 'Jabón', precio_unitario: 5, precio_botella: 27 });

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                 productos: [{ producto_id: liquido, cantidad: 2 }] }],
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(100); // el tope, sin sumar las medidas
  });
});
