import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedMaquina, seedCliente, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('POST /api/productos — validaciones', () => {
  it('crea un producto de granel y calcula los derivados y el stock en tapas', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
        volumen_envase_ml: 20000, botella_ml: 800, tapa_ml: 200,
        stock_bidones: 1, stock_botellas: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Suavizante');
    expect(res.body.sucursal).toBe('centro');
    expect(res.body.archivado).toBe(false);
    expect(res.body.tipo_liquido).toBe('granel');
    expect(Number(res.body.tapas_por_botella)).toBe(4);   // 800 / 200
    expect(Number(res.body.botellas_por_bidon)).toBe(25); // 20000 / 800
    // Stock en tapas: 10 botellas × 4 = 40 rellenadas; 1 bidón = 100 a granel.
    expect(Number(res.body.stock_actual)).toBe(40);
    expect(Number(res.body.stock_granel_tapas)).toBe(100);
  });

  it('crea un producto de marca (sin bidón)', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Ariel', tipo_liquido: 'marca', precio_unitario: 8, precio_botella: 60,
        botella_ml: 1000, tapa_ml: 200, stock_botellas: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.tipo_liquido).toBe('marca');
    expect(Number(res.body.tapas_por_botella)).toBe(5);      // 1000 / 200
    expect(Number(res.body.stock_actual)).toBe(25);          // 5 × 5
    expect(Number(res.body.stock_granel_tapas)).toBe(0);
  });

  it('acepta tapas por botella y deriva el tamaño de la tapa', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Cloro', tipo_liquido: 'granel', precio_unitario: 4, precio_botella: 30,
        volumen_envase_ml: 20000, botella_ml: 800, tapas_por_botella: 4, // sin tapa_ml
        stock_botellas: 5,
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.tapa_ml)).toBe(200);            // 800 / 4
    expect(Number(res.body.tapas_por_botella)).toBe(4);
    expect(Number(res.body.stock_actual)).toBe(20);        // 5 × 4
  });

  it('sin nombre → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ precio_unitario: 30 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nombre/i);
  });

  it('sin tamaño de botella/tapa → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Suavizante', tipo_liquido: 'granel' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/botella y de la tapa|mL/i);
  });

  it('granel sin volumen de bidón → 400', async () => {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({ nombre: 'Suavizante', tipo_liquido: 'granel', botella_ml: 800, tapa_ml: 200 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bidón/i);
  });
});

describe('movimientos de stock (rellenar / entrada / salida / historial)', () => {
  async function crearGranel(overrides = {}) {
    const res = await request(app).post('/api/productos').set(auth(admin.token)).send({
      nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
      volumen_envase_ml: 20000, botella_ml: 800, tapa_ml: 200,
      stock_bidones: 1, stock_botellas: 0, ...overrides,
    });
    return res.body;
  }

  it('rellenar mueve líquido del bidón a botellas rellenadas', async () => {
    const p = await crearGranel(); // 100 tapas a granel, 0 rellenadas
    const res = await request(app).post(`/api/productos/${p.id}/rellenar`).set(auth(admin.token))
      .send({ botellas: 15 });
    expect(res.status).toBe(200);
    // 15 botellas × 4 = 60 tapas movidas.
    expect(Number(res.body.stock_actual)).toBe(60);        // rellenadas
    expect(Number(res.body.stock_granel_tapas)).toBe(40);  // quedan en el bidón (10 botellas)
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
    expect(Number(entrada.body.stock_granel_tapas)).toBe(100);

    const salida = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 2, unidad: 'botella', motivo: 'Derrame' });
    expect(salida.status).toBe(200);
    expect(Number(salida.body.stock_actual)).toBe(12); // 20 - 8

    const excede = await request(app).post(`/api/productos/${p.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'botellas', cantidad: 100, unidad: 'botella' });
    expect(excede.status).toBe(400);
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
    expect(res.body[0].cantidad_tapas).toBe(20); // 5 × 4
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
    expect(res.body.tamano_bolsa).toBe('chica');
    expect(Number(res.body.bolsas_por_rollo)).toBe(100);
    expect(Number(res.body.stock_actual)).toBe(0); // nace vacía

    const entrada = await request(app).post(`/api/productos/${res.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 2 });
    expect(entrada.status).toBe(200);
    expect(Number(entrada.body.stock_actual)).toBe(200); // 2 rollos × 100

    const salida = await request(app).post(`/api/productos/${res.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'salida', destino: 'piezas', unidad: 'pieza', cantidad: 5 });
    expect(salida.status).toBe(200);
    expect(Number(salida.body.stock_actual)).toBe(195);
    expect(salida.body.estado_stock).toBe('ok'); // 195 > 20
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
  async function insertarMov(productoId, { tipo, destino = 'botellas', tapas, fecha }) {
    await pool.query(
      `INSERT INTO producto_movimientos
         (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, descripcion, created_at)
       VALUES ($1, 'centro', $2, $3, $4, $5, 'test', $6)`,
      [productoId, admin.id, tipo, destino, tapas, fecha]
    );
  }

  async function crearGranel() {
    const res = await request(app).post('/api/productos').set(auth(admin.token))
      .send({
        nombre: 'Suavizante', tipo_liquido: 'granel', precio_unitario: 5, precio_botella: 40,
        volumen_envase_ml: 20000, botella_ml: 800, tapa_ml: 200,
        stock_bidones: 1, stock_botellas: 12, // 12×4 = 48 tapas rellenadas; 1 bidón = 100 a granel
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('reconstruye la existencia al cierre de cualquier día y cuenta lo vendido', async () => {
    const id = await crearGranel();
    // Se controla toda la historia: se limpia el movimiento inicial que crea el
    // alta y se arma una línea de tiempo propia, fijando la existencia actual.
    //   20/ago: entran 60 tapas → cierre 60
    //   21/ago: se venden 12    → cierre 48
    //   22/ago: entran 20 tapas → cierre 68  (= existencia actual)
    await pool.query('DELETE FROM producto_movimientos WHERE producto_id = $1', [id]);
    await insertarMov(id, { tipo: 'entrada', tapas: 60, fecha: '2026-08-20 10:00:00-06' });
    await insertarMov(id, { tipo: 'venta',   tapas: 12, fecha: '2026-08-21 12:00:00-06' });
    await insertarMov(id, { tipo: 'entrada', tapas: 20, fecha: '2026-08-22 12:00:00-06' });
    await pool.query('UPDATE productos SET stock_actual = 68, stock_granel_tapas = 100 WHERE id = $1', [id]);

    const dia = async (fecha) => {
      const r = await request(app).get(`/api/productos/reporte-diario?fecha=${fecha}`).set(auth(admin.token));
      expect(r.status).toBe(200);
      return r.body.productos.find((p) => p.id === id);
    };

    const d20 = await dia('2026-08-20');
    expect(d20.tapas_por_botella).toBe(4);
    expect(d20.tapas_por_bidon).toBe(100);
    expect(d20.vendido_tapas).toBe(0);
    expect(d20.fin_botellas_tapas).toBe(60); // 68 − (−12 + 20)
    expect(d20.fin_granel_tapas).toBe(100);

    const d21 = await dia('2026-08-21');
    expect(d21.vendido_tapas).toBe(12);      // 3 botellas
    expect(d21.fin_botellas_tapas).toBe(48); // 68 − 20

    const d22 = await dia('2026-08-22');
    expect(d22.vendido_tapas).toBe(0);
    expect(d22.fin_botellas_tapas).toBe(68); // sin movimientos posteriores
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
