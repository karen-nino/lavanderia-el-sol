// Tope de cada servicio Por Encargo: lo que gasta (máquinas asignadas + material
// servido) contra su precio. Lo que se agrega de más (medidas de granel, material)
// no puede pasarlo: la nota no se crea o el cambio no se guarda. Las máquinas y el
// granel que el servicio ya trae no se bloquean: si se pasa, la pantalla lo avisa.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, auth } from '../helpers.js';

let admin;
let jabonTipo;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // Chico: $120 con 1 medida de jabón; sus máquinas (70 + 45) cuentan al asignarse.
  await seedAjustes({ precarga_medidas_chico: 1 });
  const { rows } = await pool.query(`INSERT INTO tipos_granel (nombre, orden) VALUES ('Jabón', 1) RETURNING id`);
  jabonTipo = rows[0].id;
});

const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

/** Jabón a granel del tipo Jabón, a `precio` la medida. */
async function jabon(precio) {
  const id = await seedProducto({ nombre: 'OXXI', precio_unitario: precio, stock_actual: 100 });
  await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [id, jabonTipo]);
  return id;
}

const notaChico = (medidas) => api('post', '/api/notas', {
  tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
  cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA',
    ...(medidas != null && { granel: [{ tipo_granel_id: jabonTipo, cantidad: medidas }] }) }],
});
const notas = async () => (await pool.query('SELECT COUNT(*)::int AS n FROM notas')).rows[0].n;

describe('medidas de granel de más', () => {
  it('las incluidas que caben: se crea a $120', async () => {
    await jabon(5);
    const res = await notaChico();
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(120);
  });

  it('subirlas al crear la nota hasta pasar el tope: no se crea', async () => {
    await jabon(41); // 3 × 41 = 123 > 120
    const res = await notaChico(3);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/se cobra en \$120/);
    expect(await notas()).toBe(0);
  });

  it('subirlas en Salidas hasta pasar el tope: no se guarda', async () => {
    await jabon(41); // 3 × 41 = 123 > 120
    const { body: nota } = await notaChico();
    const carga = nota.cargas[0];
    const res = await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: (await pool.query("SELECT id FROM productos WHERE nombre = 'OXXI'")).rows[0].id, cantidad: 3 });
    expect(res.status).toBe(400);
    const { rows } = await pool.query(
      'SELECT SUM(cantidad)::int AS medidas FROM nota_productos WHERE carga_id = $1', [carga.id]);
    expect(rows[0].medidas).toBe(1);
  });
});

describe('granel aún sin producto (varios del mismo tipo)', () => {
  // Dos jabones: el producto se elige en Salidas. Mientras, no gasta del tope.
  beforeEach(async () => {
    await jabon(2);
    const caro = await seedProducto({ nombre: 'PERSIL', precio_unitario: 5, stock_actual: 100 });
    await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [caro, jabonTipo]);
  });

  it('mientras no se elige no cuenta en Usado', async () => {
    const res = await notaChico(2);
    expect(res.status).toBe(201);
    const { body } = await api('get', `/api/notas/${res.body.id}`);
    expect(body.tope_nota.usado).toBe(0);
  });

  it('el que trae el cliente no gasta del tope', async () => {
    const { body: nota } = await notaChico(1);
    const carga = nota.cargas[0];
    const res = await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { del_cliente: true, cantidad: 10 });
    expect(res.status).toBe(200);
  });
});

describe('lo que el servicio ya trae no se bloquea', () => {
  /** Lavadora mediana disponible en centro. */
  const lavadora = async () => (await pool.query(
    `INSERT INTO maquinas (nombre, tipo, estado, sucursal)
     VALUES ('L1', 'lavadora_mediana', 'disponible', 'centro') RETURNING id`)).rows[0].id;

  // Caso real (nota 0138): la nota iba en 125 de 140 y otra lavadora la pasaba.
  it('agregar una máquina que deja la nota pasada del tope se rechaza', async () => {
    const producto = await jabon(41);
    const { body: nota } = await notaChico(); // 41 de jabón
    const carga = nota.cargas[0];
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: producto, cantidad: 2 }).expect(200); // 82
    const res = await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [await lavadora()], cobrar: false });
    expect(res.status).toBe(400); // 82 + 70 = 152 > 120
    expect(res.body.message).toMatch(/se pasa del tope/);
    const { body } = await api('get', `/api/notas/${nota.id}`);
    expect(body.tope_nota.usado).toBe(82);
  });

  it('elegir las medidas que ya traía no se bloquea aunque la nota ya se pase', async () => {
    const producto = await jabon(41);
    const { body: nota } = await notaChico();
    const carga = nota.cargas[0];
    await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { carga_id: carga.id, maquina_ids: [await lavadora()], cobrar: true }).expect(200);
    // Una lavadora más cara: 100 + 41 = 141, ya se pasa de 120.
    await pool.query('UPDATE nota_cargas SET precio_lavadora = 100 WHERE id = $1', [carga.id]);
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: producto, cantidad: 2 }).expect(400); // la de más sí se bloquea
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: producto, cantidad: 1 }).expect(200);
  });

  // Del cliente no gasta del tope: pasar de "lo trae el cliente" a un producto
  // con las mismas medidas no puede saltarse el tope.
  it('las medidas que trajo el cliente no abren lugar para el producto', async () => {
    const producto = await jabon(41);
    const { body: nota } = await notaChico();
    const carga = nota.cargas[0];
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { del_cliente: true, cantidad: 3 }).expect(200);
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: producto, cantidad: 3 }).expect(400); // 3 × 41 = 123 > 120
  });

  // Caso real (nota 0137): el servicio se creó sin tipo de máquina y la lavadora
  // se agregó en Salidas sin cobro. La paga el servicio: cuenta en Usado.
  it('la máquina agregada sin cobro gasta del tope a su tarifa; la cobrada aparte no', async () => {
    const { body: sinCobro } = await notaChico(0);
    await api('patch', `/api/notas/${sinCobro.id}/asignar-maquina`,
      { maquina_ids: [await lavadora()], cobrar: false }).expect(200);
    expect((await api('get', `/api/notas/${sinCobro.id}`)).body.tope_nota.usado).toBe(70);

    const { rows: [{ id: l2 }] } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, estado, sucursal)
       VALUES ('L2', 'lavadora_mediana', 'disponible', 'centro') RETURNING id`);
    const { body: cobrada } = await notaChico(0);
    await api('patch', `/api/notas/${cobrada.id}/asignar-maquina`,
      { maquina_ids: [l2], cobrar: true }).expect(200);
    expect((await api('get', `/api/notas/${cobrada.id}`)).body.tope_nota.usado).toBe(0);
  });

  // En Edredón la lavadora cuenta a la tarifa de su tamaño, no a la de edredón.
  it('Edredón: una lavadora mediana gasta lo de una mediana', async () => {
    await seedAjustes({ precarga_medidas_chico: 1, precio_carga_mediana: 50, precio_edredon_jumbo: 80, tope_carga_edredon: 200 });
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'EDREDON', estado_pago: 'PENDIENTE',
      cargas: [{ tipo_prenda: 'EDREDON' }],
    }).expect(201);
    await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [await lavadora()], cobrar: false }).expect(200);
    expect((await api('get', `/api/notas/${nota.id}`)).body.tope_nota.usado).toBe(50);
  });
});

describe('Relavar y Más secado (Por Encargo)', () => {
  const maquina = async (nombre, tipo) => (await pool.query(
    `INSERT INTO maquinas (nombre, tipo, estado, sucursal)
     VALUES ($1, $2, 'disponible', 'centro') RETURNING id`, [nombre, tipo])).rows[0].id;

  /** Nota Chico con una lavadora mediana ya usada y soltada (renglón con hueco libre). */
  async function conLavadoTerminado() {
    await jabon(5);
    const { body: nota } = await notaChico();
    const l1 = await maquina('L1', 'lavadora_mediana');
    await api('patch', `/api/notas/${nota.id}/asignar-maquina`, { maquina_ids: [l1], cobrar: false }).expect(200);
    const { rows: [carga] } = await pool.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND precio_tope IS NULL', [nota.id]);
    // Terminó: el hueco queda libre y la máquina, como usada.
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE id = $1', [carga.id]);
    return { notaId: nota.id, cargaId: carga.id };
  }

  it('ni un empleado ni un admin normal pueden relavar: solo el Admin Main', async () => {
    const { notaId, cargaId } = await conLavadoTerminado();
    for (const rol of ['operador', 'admin']) {
      const u = await seedUsuario({ rol, sucursal: 'centro', nombre: `U ${rol}` });
      const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`).set(auth(u.token))
        .send({ maquina_ids: [await maquina(`L-${rol}`, 'lavadora_mediana')], carga_id: cargaId, cobrar: false });
      expect(res.status).toBe(403);
    }
  });

  it('el admin de prueba sí puede relavar (solo ve la sucursal de pruebas)', async () => {
    await seedSucursal('pruebas');
    const prueba = await seedUsuario({ rol: 'admin', sucursal: 'pruebas', nombre: 'Prueba' });
    await pool.query('UPDATE usuarios SET es_prueba = TRUE WHERE id = $1', [prueba.id]);
    const comoPrueba = (m, url, body) => request(app)[m](url).set(auth(prueba.token, 'pruebas')).send(body);
    const enPruebas = async (nombre) => (await pool.query(
      `INSERT INTO maquinas (nombre, tipo, estado, sucursal)
       VALUES ($1, 'lavadora_mediana', 'disponible', 'pruebas') RETURNING id`, [nombre])).rows[0].id;
    const { body: nota } = await comoPrueba('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
    }).expect(201);
    await comoPrueba('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [await enPruebas('P1')], cobrar: false }).expect(200);
    const { rows: [carga] } = await pool.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND precio_tope IS NULL', [nota.id]);
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE id = $1', [carga.id]);
    await comoPrueba('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [await enPruebas('P2')], carga_id: carga.id, cobrar: false }).expect(200);
  });

  it('el Admin Main relava en otra más cara: un solo ciclo y Usado no sube', async () => {
    await seedAjustes({ precarga_medidas_chico: 1, precio_carga_mediana: 50, precio_carga_jumbo: 90 });
    const { notaId, cargaId } = await conLavadoTerminado();
    const antes = (await api('get', `/api/notas/${notaId}`)).body.tope_nota.usado;
    expect(antes).toBe(55); // jabón 5 + mediana 50
    const jumbo = await maquina('L9', 'lavadora_jumbo');
    const main = await seedUsuario({ rol: 'admin_main', sucursal: 'centro', nombre: 'Main' });
    await request(app).patch(`/api/notas/${notaId}/asignar-maquina`).set(auth(main.token))
      .send({ maquina_ids: [jumbo], carga_id: cargaId, cobrar: false }).expect(200);
    expect((await api('get', `/api/notas/${notaId}`)).body.tope_nota.usado).toBe(antes);
    const { rows } = await pool.query(
      'SELECT ciclo_unico FROM nota_carga_maquinas WHERE carga_id = $1 AND maquina_id = $2', [cargaId, jumbo]);
    expect(rows[0].ciclo_unico).toBe(true);
  });
});
