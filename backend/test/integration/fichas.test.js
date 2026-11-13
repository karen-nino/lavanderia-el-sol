// Inventario de fichas (mig. 176): la máquina "Trabaja con fichas: sin Sonoff y
// sin tiempos" pide cuántas fichas al iniciar si su sucursal usa fichas; salen
// de las disponibles y entran a la máquina, y se recogen desde Inventario.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedAjustes, auth } from '../helpers.js';
import { finalizarMaquinasAlTope } from '../../jobs/finalizarAlTope.js';

let admin;
let empleado;
let secadora;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await pool.query(`UPDATE sucursales SET usa_fichas = TRUE, fichas_disponibles = 10 WHERE slug = 'centro'`);
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Emp' });
  await seedAjustes({ precio_carga_secadora: 50 });
  const { rows: [marca] } = await pool.query(`INSERT INTO marcas_maquina (nombre) VALUES ('MAYTAG') RETURNING id`);
  await pool.query(
    `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, solo_fichas)
     VALUES ($1, 'Maytag2', 'secadora', 'mediana', TRUE)`,
    [marca.id]
  );
  const { rows: [s] } = await pool.query(
    `INSERT INTO maquinas (nombre, tipo, tamano, sucursal, marca, modelo)
     VALUES ('S2', 'secadora', 'mediana', 'centro', 'MAYTAG', 'Maytag2') RETURNING id`
  );
  secadora = s.id;
  await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 0 }).expect(201);
});

const api = (m, url, body, token = admin.token) => request(app)[m](url).set(auth(token)).send(body);

/** Nota de Autoservicio con la secadora asignada, sin arrancar. */
async function notaConSecadora() {
  const nota = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ secadora_id: secadora }],
  }).expect(201);
  return nota.body.id;
}

const disponibles = async () =>
  (await pool.query(`SELECT fichas_disponibles FROM sucursales WHERE slug = 'centro'`)).rows[0].fichas_disponibles;
const dentro = async () =>
  (await pool.query('SELECT fichas_dentro FROM maquinas WHERE id = $1', [secadora])).rows[0].fichas_dentro;

describe('iniciar una máquina de fichas', () => {
  it('sin decir cuántas fichas no arranca', async () => {
    const nota = await notaConSecadora();
    const res = await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FICHAS_SIN_ELEGIR');
    expect(await disponibles()).toBe(10);
  });

  it('las fichas salen del inventario, entran a la máquina y quedan en la pasada', async () => {
    const nota = await notaConSecadora();
    const res = await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 2 });
    expect(res.status).toBe(200);
    expect(res.body.fichas_disponibles).toBe(8);
    expect(await disponibles()).toBe(8);
    expect(await dentro()).toBe(2);
    const { rows: [p] } = await pool.query('SELECT fichas FROM nota_carga_maquinas WHERE maquina_id = $1', [secadora]);
    expect(p.fichas).toBe(2);
    const { rows: [mov] } = await pool.query('SELECT tipo, cantidad, disponibles_despues FROM fichas_movimientos');
    expect(mov).toEqual({ tipo: 'uso', cantidad: -2, disponibles_despues: 8 });
  });

  it('solo 1, 2 o 3 fichas', async () => {
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 4 }).expect(400);
  });

  it('si no alcanzan, arranca igual y el conteo queda negativo', async () => {
    await pool.query(`UPDATE sucursales SET fichas_disponibles = 1 WHERE slug = 'centro'`);
    const nota = await notaConSecadora();
    const res = await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 3 });
    expect(res.status).toBe(200);
    expect(res.body.fichas_disponibles).toBe(-2);
  });

  it('en una sucursal sin fichas no se preguntan', async () => {
    await pool.query(`UPDATE sucursales SET usa_fichas = FALSE WHERE slug = 'centro'`);
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora }).expect(200);
    expect(await disponibles()).toBe(10);
    expect(await dentro()).toBe(0);
  });

  it('la lista de máquinas dice cuál pide fichas', async () => {
    const { body } = await api('get', '/api/maquinas');
    expect(body.find(m => m.id === secadora).pide_fichas).toBe(true);
    expect(body.find(m => m.id === secadora).max_fichas).toBe(3);
  });

  it('el modelo limita cuántas fichas se ofrecen (mig. 178)', async () => {
    await pool.query('UPDATE modelos_maquina SET max_fichas = 2');
    const { body } = await api('get', '/api/maquinas');
    expect(body.find(m => m.id === secadora).max_fichas).toBe(2);
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 3 }).expect(400);
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 2 }).expect(200);
    expect(await dentro()).toBe(2);
  });

  it('el admin cambia el máximo de fichas del modelo en Ajustes, de 1 a 3', async () => {
    const { rows: [mo] } = await pool.query('SELECT id FROM modelos_maquina');
    const { body } = await api('put', '/api/etiquetas/tiempos-marca', { modelo_id: mo.id, max_fichas: 2 }).expect(200);
    expect(body.max_fichas).toBe(2);
    await api('put', '/api/etiquetas/tiempos-marca', { modelo_id: mo.id, max_fichas: 4 }).expect(400);
    await api('put', '/api/etiquetas/tiempos-marca', { modelo_id: mo.id, max_fichas: 0 }).expect(400);
    const { body: lista } = await api('get', '/api/etiquetas/tiempos-marca');
    expect(lista.find(t => t.modelo_id === mo.id).max_fichas).toBe(2);
  });
});

describe('fichas sin Sonoff y con tiempos (mig. 177)', () => {
  beforeEach(async () => {
    await pool.query('UPDATE modelos_maquina SET solo_fichas = FALSE, fichas_con_tiempo = TRUE, minutos_por_ficha = 15');
  });
  const ciclo = async () =>
    (await pool.query('SELECT ciclo_minutos, estado FROM maquinas WHERE id = $1', [secadora])).rows[0];

  it('el tope es fichas × "Cada ficha" y sigue pidiendo fichas', async () => {
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora })
      .expect(400);
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 2 }).expect(200);
    expect((await ciclo()).ciclo_minutos).toBe(30);
    expect(await disponibles()).toBe(8);
    const { body } = await api('get', '/api/maquinas');
    expect(body.find(m => m.id === secadora)).toMatchObject({ solo_fichas: true, con_iniciar: true });
  });

  it('sin "Cada ficha" no tiene tope', async () => {
    await pool.query('UPDATE modelos_maquina SET minutos_por_ficha = NULL');
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 1 }).expect(200);
    expect((await ciclo()).ciclo_minutos).toBeNull();
  });

  it('al llegar al tope se finaliza sola', async () => {
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 1 }).expect(200);
    await pool.query(`UPDATE maquinas SET en_uso_desde = NOW() - INTERVAL '16 minutes' WHERE id = $1`, [secadora]);
    await finalizarMaquinasAlTope();
    expect((await ciclo()).estado).toBe('disponible');
  });

  it('las dos casillas de fichas sin Sonoff se excluyen', async () => {
    const { rows: [mo] } = await pool.query('SELECT id FROM modelos_maquina');
    const { body: a } = await api('put', `/api/etiquetas/modelos-maquina/${mo.id}`, { solo_fichas: true }).expect(200);
    expect([a.solo_fichas, a.fichas_con_tiempo]).toEqual([true, false]);
    const { body: b } = await api('put', `/api/etiquetas/modelos-maquina/${mo.id}`, { fichas_con_tiempo: true }).expect(200);
    expect([b.solo_fichas, b.fichas_con_tiempo]).toEqual([false, true]);
  });
});

describe('Inventario → Fichas', () => {
  it('el empleado ve y recoge las fichas de una máquina', async () => {
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 3 }).expect(200);

    const antes = (await api('get', '/api/fichas', null, empleado.token)).body;
    expect(antes).toMatchObject({ usa_fichas: true, disponibles: 7, dentro: 3 });
    expect(antes.maquinas.find(m => m.id === secadora).fichas_dentro).toBe(3);

    const res = await api('post', '/api/fichas/recoger', { maquina_id: secadora }, empleado.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recogidas: 3, disponibles: 10, dentro: 0 });
    expect(res.body.movimientos[0]).toMatchObject({ tipo: 'recoger', cantidad: 3, maquina_nombre: 'S2' });
  });

  it('el historial filtra por fechas', async () => {
    const nota = await notaConSecadora();
    await api('patch', `/api/notas/${nota}/activar-pendientes`, { maquina_id: secadora, fichas: 2 }).expect(200);
    await pool.query(`UPDATE fichas_movimientos SET created_at = '2026-01-15T12:00:00Z'`);
    await api('post', '/api/fichas/recoger', { maquina_id: secadora }, empleado.token).expect(200);

    const enero = (await api('get', '/api/fichas/historial?desde=2026-01-01T06:00:00Z&hasta=2026-02-01T06:00:00Z', null, empleado.token)).body;
    expect(enero.movimientos.map(m => [m.tipo, m.cantidad, m.folio != null])).toEqual([['uso', -2, true]]);
    expect(enero.anios).toContain(2026);
    await api('get', '/api/fichas/historial?desde=nada&hasta=2026-02-01').expect(400);
  });

  it('solo el admin corrige el conteo, y queda la diferencia en el historial', async () => {
    await api('post', '/api/fichas/ajustar', { disponibles: 107 }, empleado.token).expect(403);
    const res = await api('post', '/api/fichas/ajustar', { disponibles: 107 });
    expect(res.status).toBe(200);
    expect(res.body.disponibles).toBe(107);
    expect(res.body.movimientos[0]).toMatchObject({ tipo: 'ajuste', cantidad: 97 });
    await api('post', '/api/fichas/ajustar', { disponibles: -1 }).expect(400);
  });
});

describe('Ajustes → Fichas', () => {
  it('el admin enciende o apaga las fichas de una sucursal', async () => {
    await seedSucursal('norte', 'Norte');
    const res = await api('patch', '/api/fichas/sucursales/norte', { usa_fichas: true });
    expect(res.status).toBe(200);
    expect(res.body.usa_fichas).toBe(true);
    const lista = (await api('get', '/api/fichas/sucursales')).body;
    expect(lista.map(s => [s.slug, s.usa_fichas])).toEqual(expect.arrayContaining([['centro', true], ['norte', true]]));
    await api('patch', '/api/fichas/sucursales/norte', { usa_fichas: false }, empleado.token).expect(403);
  });

  it('el admin fija cuántas fichas hay en una sucursal y queda en el historial', async () => {
    const res = await api('patch', '/api/fichas/sucursales/centro', { fichas_disponibles: 107 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fichas_disponibles: 107, fichas_dentro: 0 });
    const { rows: [mov] } = await pool.query(`SELECT tipo, cantidad, disponibles_despues FROM fichas_movimientos`);
    expect(mov).toEqual({ tipo: 'ajuste', cantidad: 97, disponibles_despues: 107 });
    await api('patch', '/api/fichas/sucursales/centro', { fichas_disponibles: 'muchas' }).expect(400);
    await api('patch', '/api/fichas/sucursales/centro', { fichas_disponibles: 5 }, empleado.token).expect(403);
  });
});
