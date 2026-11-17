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

  it('asignar la máquina aunque se pase: se deja y Usado lo dice', async () => {
    const producto = await jabon(41);
    const { body: nota } = await notaChico(); // 41 de jabón
    const carga = nota.cargas[0];
    // Más medidas de las que trae, pero aún caben: 2 × 41 = 82.
    await api('put', `/api/notas/${nota.id}/cargas/${carga.id}/granel/${jabonTipo}`,
      { producto_id: producto, cantidad: 2 }).expect(200);
    const res = await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { carga_id: carga.id, maquina_ids: [await lavadora()], cobrar: true });
    expect(res.status).toBe(200);
    const { body } = await api('get', `/api/notas/${nota.id}`);
    expect(body.tope_nota.usado).toBe(152); // 82 + 70 > 120
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
});
