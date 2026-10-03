import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedMaquina,
  seedCliente, seedEtiquetas, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // El catálogo de tamaños de bolsa lo siembra la mig. 119, pero limpiarBase
  // lo vacía: sin él no se puede dar de alta una bolsa.
  await seedEtiquetas('tamanos_bolsa', ['Chica', 'Grande', 'Jumbo']);
});

describe('POST /api/productos — validaciones', () => {
  it('crea un producto de granel y calcula los derivados y el stock en medidas', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
        volumen_envase_ml: 20000, botella_ml: 800, medida_ml: 200,
        stock_bidones: 1, stock_botellas: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Suavizante');
    expect(res.body.sucursal).toBe('centro');
    expect(res.body.archivado).toBe(false);
    expect(res.body.tipo_liquido).toBe('granel');
    expect(Number(res.body.medidas_por_botella)).toBe(4);   // 800 / 200
    expect(Number(res.body.botellas_por_bidon)).toBe(25); // 20000 / 800
    // Stock en medidas: 10 botellas × 4 = 40 rellenadas; 1 bidón = 100 a granel.
    expect(Number(res.body.stock_actual)).toBe(40);
    expect(Number(res.body.stock_granel_medidas)).toBe(100);
  });

  it('crea un producto de marca (sin bidón)', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Ariel', tipo_liquido: 'marca', precio_unitario: 8, precio_botella: 60,
        botella_ml: 1000, medida_ml: 200, stock_botellas: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.tipo_liquido).toBe('marca');
    expect(Number(res.body.medidas_por_botella)).toBe(5);      // 1000 / 200
    expect(Number(res.body.stock_actual)).toBe(25);          // 5 × 5
    expect(Number(res.body.stock_granel_medidas)).toBe(0);
  });

  it('acepta medidas por botella y deriva el tamaño de la medida', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Cloro', tipo_liquido: 'granel', precio_unitario: 4, precio_botella: 30,
        volumen_envase_ml: 20000, botella_ml: 800, medidas_por_botella: 4, // sin medida_ml
        stock_botellas: 5,
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.medida_ml)).toBe(200);            // 800 / 4
    expect(Number(res.body.medidas_por_botella)).toBe(4);
    expect(Number(res.body.stock_actual)).toBe(20);        // 5 × 4
  });

  it('sin nombre → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ precio_unitario: 30 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nombre/i);
  });

  it('sin tamaño de botella/medida → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Suavizante', tipo_liquido: 'granel' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/botella y de la medida|mL/i);
  });

  it('granel sin volumen de bidón → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Suavizante', tipo_liquido: 'granel', botella_ml: 800, medida_ml: 200 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bidón/i);
  });
});

describe('movimientos de stock (rellenar / entrada / salida / historial)', () => {
  async function crearGranel(overrides = {}) {
    const res = await request(app).post('/api/productos').set(auth(admin.token)).send({
      nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
      volumen_envase_ml: 20000, botella_ml: 800, medida_ml: 200,
      stock_bidones: 1, stock_botellas: 0, ...overrides,
    });
    return res.body;
  }

  it('rellenar mueve líquido del bidón a botellas rellenadas', async () => {
    const p = await crearGranel(); // 100 medidas a granel, 0 rellenadas
    const res = await request(app).post(`/api/productos/${p.id}/rellenar`).set(auth(admin.token))
      .send({ botellas: 15 });
    expect(res.status).toBe(200);
    // 15 botellas × 4 = 60 medidas movidas.
    expect(Number(res.body.stock_actual)).toBe(60);        // rellenadas
    expect(Number(res.body.stock_granel_medidas)).toBe(40);  // quedan en el bidón (10 botellas)
  });

  it('rellenar por encima de lo disponible a granel → 400 (topado)', async () => {
    const p = await crearGranel(); // alcanza para 25 botellas
    const res = await request(app).post(`/api/productos/${p.id}/rellenar`).set(auth(admin.token))
      .send({ botellas: 30 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/alcanza para 25/i);
  });

  it('entrada de bidón sube el granel; salida de botellas valida existencia', async () => {
    const p = await crearGranel({ stock_bidones: 0, stock_botellas: 5 }); // 0 granel, 20 rellenadas

    const entrada = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', destino: 'granel', cantidad: 1, unidad: 'bidon' });
    expect(entrada.status).toBe(200);
    expect(Number(entrada.body.stock_granel_medidas)).toBe(100);

    const salida = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 2, unidad: 'botella', motivo: 'Derrame' });
    expect(salida.status).toBe(200);
    expect(Number(salida.body.stock_actual)).toBe(12); // 20 - 8

    const excede = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 100, unidad: 'botella', motivo: 'Merma' });
    expect(excede.status).toBe(400);
    expect(excede.body.message).toMatch(/no hay suficiente/i);
  });

  it('la salida manual pide su motivo y lo guarda en el historial', async () => {
    const p = await crearGranel({ stock_bidones: 0, stock_botellas: 5 });

    const sinMotivo = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 1, unidad: 'botella' });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.message).toMatch(/por qué sale/i);

    await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 1, unidad: 'botella', motivo: 'Dañado' })
      .expect(200);
    const hist = await request(app).get(`/api/productos/${p.id}/movimientos?tipo=salidas`).set(auth(admin.token));
    expect(hist.body[0].motivo).toBe('Dañado');
  });

  it('el historial registra cada movimiento (más reciente primero)', async () => {
    const p = await crearGranel();
    await request(app).post(`/api/productos/${p.id}/rellenar`).set(auth(admin.token))
      .send({ botellas: 5 }).expect(200);

    const res = await request(app).get(`/api/productos/${p.id}/movimientos`).set(auth(admin.token));
    expect(res.status).toBe(200);
    // Entrada inicial del bidón + el rellenado.
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].tipo).toBe('rellenar');
    expect(res.body[0].cantidad_medidas).toBe(20); // 5 × 4
  });
});

describe('bolsas (clase = bolsa)', () => {
  it('crea una bolsa; entrada por rollo suma piezas y salida por pieza descuenta', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa chica', tamano_bolsa: 'chica',
      bolsas_por_rollo: 100, precio_unitario: 3, stock_minimo: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body.clase).toBe('bolsa');
    expect(res.body.tamano_bolsa).toBe('Chica'); // tal como está en el catálogo
    expect(Number(res.body.bolsas_por_rollo)).toBe(100);
    expect(Number(res.body.stock_actual)).toBe(0); // nace vacía

    const entrada = await request(app).post(`/api/productos/${res.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 2 });
    expect(entrada.status).toBe(200);
    expect(Number(entrada.body.stock_actual)).toBe(200); // 2 rollos × 100

    const salida = await request(app).post(`/api/productos/${res.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'piezas', unidad: 'pieza', cantidad: 5, motivo: 'Uso interno' });
    expect(salida.status).toBe(200);
    expect(Number(salida.body.stock_actual)).toBe(195);
    expect(salida.body.estado_stock).toBe('ok'); // 195 > 20
  });

  it('un tamaño que sí está en el catálogo se acepta aunque no sea de los tres de siempre', async () => {
    await seedEtiquetas('tamanos_bolsa', ['Extra grande']);
    const res = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'extra grande', bolsas_por_rollo: 50,
    });
    expect(res.status).toBe(201);
    expect(res.body.tamano_bolsa).toBe('Extra grande');
  });

  it('renombrar el tamaño en Ajustes renombra la bolsa que lo usa', async () => {
    await seedEtiquetas('tamanos_bolsa', ['Spe']);
    const bolsa = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'spe', bolsas_por_rollo: 50,
    });
    expect(bolsa.body.tamano_bolsa).toBe('Spe');

    const { rows } = await pool.query(`SELECT id FROM tamanos_bolsa WHERE nombre = 'Spe'`);
    const ren = await request(app).put(`/api/etiquetas/tamanos-bolsa/${rows[0].id}`)
      .set(auth(admin.token)).send({ nombre: 'SPE' });
    expect(ren.status).toBe(200);

    const { rows: [p] } = await pool.query('SELECT tamano_bolsa FROM productos WHERE id = $1', [bolsa.body.id]);
    expect(p.tamano_bolsa).toBe('SPE');
  });

  it('tamaño de bolsa inválido → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'mediana', bolsas_por_rollo: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tamaño de bolsa/i);
  });
});

describe('GET /api/productos — aislamiento y archivados', () => {
  it('solo lista los activos de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedProducto({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedProducto({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/productos').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });

  it('los archivados no salen en la lista normal, sí con ?archivados=1', async () => {
    const id = await seedProducto({ nombre: 'Viejo' });
    await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: true }).expect(200);

    const normal = await request(app).get('/api/productos').set(auth(admin.token));
    expect(normal.body.map((p) => p.id)).not.toContain(id);

    const archivados = await request(app).get('/api/productos?archivados=1').set(auth(admin.token));
    expect(archivados.body.map((p) => p.id)).toContain(id);
  });
});

describe('PATCH /api/productos/:id/archivar', () => {
  it('archiva y restaura un producto (solo admin)', async () => {
    const id = await seedProducto({ nombre: 'Detergente' });

    const arch = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: true });
    expect(arch.status).toBe(200);
    expect(arch.body.archivado).toBe(true);

    const rest = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(admin.token))
      .send({ archivado: false });
    expect(rest.status).toBe(200);
    expect(rest.body.archivado).toBe(false);
  });

  it('un empleado no puede archivar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedProducto();
    const res = await request(app).patch(`/api/productos/${id}/archivar`).set(auth(empleado.token))
      .send({ archivado: true });
    expect(res.status).toBe(403);
  });

  it('un producto de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedProducto({ sucursal: 'norte' });
    const res = await request(app).patch(`/api/productos/${ajeno}/archivar`).set(auth(admin.token, 'centro'))
      .send({ archivado: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE múltiple /api/productos/eliminar-multiples', () => {
  // Un producto usado en una nota (nota_productos) no se puede borrar; queda
  // bloqueado y se archiva en vez de eliminar (lo maneja la UI).
  async function productoUsadoEnNota() {
    const productoId = await seedProducto({ nombre: 'Usado' });
    const clienteId = await seedCliente();
    await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: productoId, cantidad: 1 }],
    }).expect(201);
    return productoId;
  }

  it('dry-run marca como bloqueado el usado en una nota y borra solo el libre', async () => {
    const libre = await seedProducto({ nombre: 'Libre' });
    const usado = await productoUsadoEnNota();

    const dry = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, usado], confirmar: false });
    expect(dry.status).toBe(200);
    expect(dry.body.eliminables).toContain(libre);
    expect(dry.body.bloqueados.map((b) => b.id)).toContain(usado);

    const del = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [libre, usado], confirmar: true });
    expect(del.status).toBe(200);
    expect(del.body.eliminados).toEqual([libre]);
    // El usado sigue existiendo (para el historial de la nota).
    const { rows } = await pool.query('SELECT id FROM productos WHERE id = $1', [usado]);
    expect(rows).toHaveLength(1);
  });

  it('sin ids → 400', async () => {
    const res = await request(app).post('/api/productos/eliminar-multiples').set(auth(admin.token))
      .send({ ids: [], confirmar: false });
    expect(res.status).toBe(400);
  });

  it('solo admin (un empleado recibe 403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).post('/api/productos/eliminar-multiples').set(auth(empleado.token))
      .send({ ids: [1], confirmar: false });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/productos/reporte-diario', () => {
  // Inserta un movimiento con fecha controlada (hora local MX) para probar la
  // reconstrucción de la existencia al cierre de un día.
  async function insertarMov(productoId, { tipo, destino = 'botellas', medidas, fecha }) {
    await pool.query(
      `INSERT INTO producto_movimientos
         (producto_id, sucursal, usuario_id, tipo, destino, cantidad_medidas, descripcion, created_at)
       VALUES ($1, 'centro', $2, $3, $4, $5, 'test', $6)`,
      [productoId, admin.id, tipo, destino, medidas, fecha]
    );
  }

  async function crearGranel() {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
        volumen_envase_ml: 20000, botella_ml: 800, medida_ml: 200,
        stock_bidones: 1, stock_botellas: 12, // 12×4 = 48 medidas rellenadas; 1 bidón = 100 a granel
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('reconstruye la existencia al cierre de cualquier día y cuenta lo vendido', async () => {
    const id = await crearGranel();
    // Se controla toda la historia: se limpia el movimiento inicial que crea el
    // alta y se arma una línea de tiempo propia, fijando la existencia actual.
    //   20/ago: entran 60 medidas → cierre 60
    //   21/ago: se venden 12    → cierre 48
    //   22/ago: entran 20 medidas → cierre 68  (= existencia actual)
    await pool.query('DELETE FROM producto_movimientos WHERE producto_id = $1', [id]);
    await insertarMov(id, { tipo: 'entrada', medidas: 60, fecha: '2026-08-20 10:00:00-06' });
    await insertarMov(id, { tipo: 'venta',   medidas: 12, fecha: '2026-08-21 12:00:00-06' });
    await insertarMov(id, { tipo: 'entrada', medidas: 20, fecha: '2026-08-22 12:00:00-06' });
    await pool.query('UPDATE productos SET stock_actual = 68, stock_granel_medidas = 100 WHERE id = $1', [id]);

    const dia = async (fecha) => {
      const r = await request(app).get(`/api/productos/reporte-diario?fecha=${fecha}`).set(auth(admin.token));
      expect(r.status).toBe(200);
      return r.body.productos.find((p) => p.id === id);
    };

    const d20 = await dia('2026-08-20');
    expect(d20.medidas_por_botella).toBe(4);
    expect(d20.medidas_por_bidon).toBe(100);
    expect(d20.vendido_medidas).toBe(0);
    expect(d20.fin_botellas_medidas).toBe(60); // 68 − (−12 + 20)
    expect(d20.fin_granel_medidas).toBe(100);

    const d21 = await dia('2026-08-21');
    expect(d21.vendido_medidas).toBe(12);      // 3 botellas
    expect(d21.fin_botellas_medidas).toBe(48); // 68 − 20

    const d22 = await dia('2026-08-22');
    expect(d22.vendido_medidas).toBe(0);
    expect(d22.fin_botellas_medidas).toBe(68); // sin movimientos posteriores
  });

  // Una venta anulada el mismo día devuelve el producto al estante (movimiento
  // 'liberacion'). Antes "Salió" seguía contándola y contradecía a "Queda al
  // final", que sí veía la devolución.
  it('resta del día lo que se devolvió al anular una venta', async () => {
    const id = await crearGranel();
    await pool.query('DELETE FROM producto_movimientos WHERE producto_id = $1', [id]);
    await insertarMov(id, { tipo: 'venta',      medidas: 12, fecha: '2026-08-21 10:00:00-06' });
    await insertarMov(id, { tipo: 'liberacion', medidas: 4,  fecha: '2026-08-21 18:00:00-06' });
    await pool.query('UPDATE productos SET stock_actual = 40 WHERE id = $1', [id]);

    const r = await request(app).get('/api/productos/reporte-diario?fecha=2026-08-21').set(auth(admin.token));
    expect(r.status).toBe(200);
    const p = r.body.productos.find((x) => x.id === id);
    expect(p.vendido_medidas).toBe(8);   // 12 vendidas − 4 devueltas
    expect(p.devuelto_medidas).toBe(4);
    expect(p.fin_botellas_medidas).toBe(40);
  });

  // Lo que se devuelve hoy pudo venderse ayer: ese día no salió producto, entró.
  it('un día que solo tuvo devoluciones sale en negativo y lo explica', async () => {
    const id = await crearGranel();
    await pool.query('DELETE FROM producto_movimientos WHERE producto_id = $1', [id]);
    await insertarMov(id, { tipo: 'venta',      medidas: 8, fecha: '2026-08-20 10:00:00-06' });
    await insertarMov(id, { tipo: 'liberacion', medidas: 8, fecha: '2026-08-21 10:00:00-06' });

    const r = await request(app).get('/api/productos/reporte-diario?fecha=2026-08-21').set(auth(admin.token));
    const p = r.body.productos.find((x) => x.id === id);
    expect(p.vendido_medidas).toBe(-8);
    expect(p.devuelto_medidas).toBe(8);
  });

  // El caso real: venta de mostrador cobrada y borrada el mismo día.
  it('una venta de mostrador borrada el mismo día deja de contar como salida', async () => {
    const id = await crearGranel();
    const venta = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'PRODUCTOS', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      productos: [{ producto_id: id, cantidad: 1 }],   // 1 botella = 4 medidas
    });
    expect(venta.status).toBe(201);

    const conVenta = await request(app).get('/api/productos/reporte-diario').set(auth(admin.token));
    expect(conVenta.body.productos.find((x) => x.id === id).vendido_medidas).toBe(4);

    await request(app).delete(`/api/notas/${venta.body.id}`).set(auth(admin.token)).expect(204);

    const despues = await request(app).get('/api/productos/reporte-diario').set(auth(admin.token));
    const p = despues.body.productos.find((x) => x.id === id);
    expect(p.vendido_medidas).toBe(0);    // la venta se deshizo: no salió nada
    expect(p.devuelto_medidas).toBe(4);
    // Y "queda al final" coincide con la existencia intacta.
    const { rows } = await pool.query('SELECT stock_actual FROM productos WHERE id = $1', [id]);
    expect(p.fin_botellas_medidas).toBe(Number(rows[0].stock_actual));
  });

  it('sin fecha usa el día de hoy (200)', async () => {
    await crearGranel();
    const res = await request(app).get('/api/productos/reporte-diario').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fecha');
    expect(Array.isArray(res.body.productos)).toBe(true);
  });

  it('excluye bolsas y archivados; solo líquidos marca/granel', async () => {
    await crearGranel();
    await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Bolsa', clase: 'bolsa', tamano_bolsa: 'chica', bolsas_por_rollo: 100, precio_unitario: 2 });
    const res = await request(app).get('/api/productos/reporte-diario').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.productos.every((p) => ['granel', 'marca'].includes(p.tipo_liquido))).toBe(true);
  });

  it('solo admin (un empleado recibe 403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).get('/api/productos/reporte-diario').set(auth(empleado.token));
    expect(res.status).toBe(403);
  });
});

describe('tipo de granel en el producto (mig. 136)', () => {
  const granel = (extra = {}) => ({
    nombre: 'OXXI', tipo_liquido: 'granel', forma: 'liquido',
    volumen_envase_ml: 20000, botella_ml: 1000, medida_ml: 100, ...extra,
  });

  it('el granel líquido guarda su tipo y se le puede quitar', async () => {
    const { rows } = await pool.query(`INSERT INTO tipos_granel (nombre) VALUES ('Jabón') RETURNING id`);
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send(granel({ tipo_granel_id: rows[0].id }));
    expect(res.status).toBe(201);
    expect(res.body.tipo_granel_id).toBe(rows[0].id);

    const edit = await request(app).put(`/api/productos/${res.body.id}`).set(auth(admin.token))
      .send(granel({ tipo_granel_id: '' }));
    expect(edit.status).toBe(200);
    expect(edit.body.tipo_granel_id).toBeNull();
  });

  it('el polvo no lleva tipo aunque lo mande', async () => {
    const { rows } = await pool.query(`INSERT INTO tipos_granel (nombre) VALUES ('Jabón') RETURNING id`);
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'TRATA', tipo_liquido: 'granel', forma: 'polvo', precio_botella: 10, tipo_granel_id: rows[0].id });
    expect(res.status).toBe(201);
    expect(res.body.tipo_granel_id).toBeNull();
  });

  it('un tipo que no existe → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send(granel({ tipo_granel_id: 99999 }));
    expect(res.status).toBe(400);
  });
});
