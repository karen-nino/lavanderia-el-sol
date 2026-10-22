// Precio por programa de la secadora que pregunta (Sec49), mig. 165. En
// Autoservicio la secadora queda "por definir" hasta que al darle Iniciar se
// elige el programa: 10 min $20, 20 min $40, 30 min $50. Mientras tanto se
// abona pero no se liquida. En Por Encargo el secado va en el servicio. Más
// secado y Relavado (otra vuelta sin costo) solo en Por Encargo.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedMarca, seedAjustes, auth,
} from '../helpers.js';
import { cancelarCortesProgramados } from '../../services/sincronizarSonoff.js';

let admin;

beforeEach(async () => {
  cancelarCortesProgramados();
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  await seedAjustes({ tiempo_carga_mediana: 30, tiempo_carga_jumbo: 45, tiempo_carga_secadora: 40 });
});

const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

/** Sec49 con programas 10/20/30 y sus precios (null = por tamaño, $45). */
async function sec49(precios = [20, 40, 50]) {
  await seedMarca({ nombre: 'Speed Queen', tipo: 'secadora', tamano: 'mediana' });
  await pool.query(
    `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, minutos_2, minutos_3, minutos_4,
                                  pregunta_tiempo, minutos_por_ficha,
                                  precio_programa_2, precio_programa_3, precio_programa_4)
     SELECT id, 'Sec49', 'secadora', 'mediana', 30, 10, 20, 30, TRUE, 10, $1, $2, $3
       FROM marcas_maquina WHERE nombre = 'Speed Queen'`,
    precios
  );
  return seedMaquina({ nombre: 'S4', tipo: 'secadora', tamano: 'mediana', marca: 'Speed Queen', modelo: 'Sec49' });
}

/** Nota de Autoservicio con la secadora elegida en el alta. */
async function notaAuto(secId, extra = {}) {
  const res = await api('post', '/api/notas', {
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ secadora_id: secId }], ...extra,
  });
  return res;
}

const carga = async (notaId) => (await pool.query(
  'SELECT id, precio_secadora, secadora_por_definir FROM nota_cargas WHERE nota_id = $1 ORDER BY orden', [notaId]
)).rows[0];
const total = async (notaId) =>
  Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [notaId])).rows[0].precio_total);
const iniciar = (notaId, maquina_id, minutos) =>
  api('patch', `/api/notas/${notaId}/activar-pendientes`, { maquina_id, minutos });

describe('Autoservicio: la secadora por programa nace por definir', () => {
  it('sin precio hasta iniciarla', async () => {
    const s4 = await sec49();
    const res = await notaAuto(s4);
    expect(res.status).toBe(201);
    const c = await carga(res.body.id);
    expect(c.secadora_por_definir).toBe(true);
    expect(Number(c.precio_secadora)).toBe(0);
    expect(await total(res.body.id)).toBe(0);
  });

  it('al iniciarla toma el precio del programa elegido', async () => {
    const s4 = await sec49();
    const { body: nota } = await notaAuto(s4);
    await iniciar(nota.id, s4, 20).expect(200);
    const c = await carga(nota.id);
    expect(c.secadora_por_definir).toBe(false);
    expect(Number(c.precio_secadora)).toBe(40);
    expect(await total(nota.id)).toBe(40);
  });

  it('un programa sin precio se cobra por tamaño', async () => {
    const s4 = await sec49([20, null, 50]);
    const { body: nota } = await notaAuto(s4);
    await iniciar(nota.id, s4, 20).expect(200);
    expect(Number((await carga(nota.id)).precio_secadora)).toBe(45);
  });

  it('no se inicia sin elegir el programa', async () => {
    const s4 = await sec49();
    const { body: nota } = await notaAuto(s4);
    const res = await api('patch', `/api/notas/${nota.id}/activar-pendientes`, {});
    expect(res.status).toBe(400);
    expect((await carga(nota.id)).secadora_por_definir).toBe(true);
  });

  it('sin precios en el modelo se cobra como siempre', async () => {
    const s4 = await sec49([null, null, null]);
    const { body: nota } = await notaAuto(s4);
    const c = await carga(nota.id);
    expect(c.secadora_por_definir).toBe(false);
    expect(Number(c.precio_secadora)).toBe(45);
  });

  it('asignada en Salidas también queda por definir', async () => {
    const s4 = await sec49();
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ secadora_tipo: 'mediana' }],
    });
    await api('patch', `/api/notas/${nota.id}/asignar-carga-maquina`,
      { carga_id: nota.cargas[0].id, slot: 'secadora', maquina_id: s4 }).expect(200);
    expect((await carga(nota.id)).secadora_por_definir).toBe(true);
    await iniciar(nota.id, s4, 30).expect(200);
    expect(Number((await carga(nota.id)).precio_secadora)).toBe(50);
  });

  it('cambiarla por una secadora normal le pone su precio', async () => {
    const s4 = await sec49();
    const s1 = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const { body: nota } = await notaAuto(s4);
    await api('patch', `/api/notas/${nota.id}/cambiar-maquina`,
      { maquina_actual_id: s4, maquina_nueva_id: s1 }).expect(200);
    const c = await carga(nota.id);
    expect(c.secadora_por_definir).toBe(false);
    expect(Number(c.precio_secadora)).toBe(45);
  });

  it('cambiar la lavadora sin cobro de esa carga no la cobra', async () => {
    const s4 = await sec49();
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { body: nota } = await notaAuto(s4);
    // La lavadora entra sin cobro en la misma carga que la Sec49 por definir.
    await pool.query('UPDATE nota_cargas SET lavadora_id = $1, lavadora_usada_id = $1 WHERE nota_id = $2', [l1, nota.id]);
    await api('patch', `/api/notas/${nota.id}/cambiar-maquina`,
      { maquina_actual_id: l1, maquina_nueva_id: l2 }).expect(200);
    const { rows } = await pool.query(
      'SELECT precio_lavadora, secadora_por_definir FROM nota_cargas WHERE nota_id = $1', [nota.id]);
    expect(Number(rows[0].precio_lavadora)).toBe(0);
    expect(rows[0].secadora_por_definir).toBe(true);
  });

  it('agregada como máquina nueva también queda por definir', async () => {
    const s4 = await sec49();
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: l1 }],
    });
    await api('patch', `/api/notas/${nota.id}/asignar-maquina`, { maquina_ids: [s4], cobrar: true }).expect(200);
    const { rows } = await pool.query(
      'SELECT secadora_por_definir FROM nota_cargas WHERE nota_id = $1 AND secadora_id = $2', [nota.id, s4]);
    expect(rows[0].secadora_por_definir).toBe(true);
  });

  it('al pasar de la lavadora (tarjeta verde) se cobra el programa elegido', async () => {
    const s4 = await sec49();
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: l1 }],
    });
    await iniciar(nota.id, l1).expect(200);
    const sinTiempo = await api('patch', `/api/notas/${nota.id}/terminar-lavado`, { lavadora_id: l1, secadora_id: s4 });
    expect(sinTiempo.status).toBe(400);
    await api('patch', `/api/notas/${nota.id}/terminar-lavado`,
      { lavadora_id: l1, secadora_id: s4, minutos: 10 }).expect(200);
    expect(Number((await carga(nota.id)).precio_secadora)).toBe(20);
    expect(await total(nota.id)).toBe(70 + 20);
  });
});

describe('Autoservicio: no se liquida con la secadora por definir', () => {
  it('no nace pagada', async () => {
    const s4 = await sec49();
    const res = await notaAuto(s4, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(409);
  });

  it('se abona, pero no se liquida hasta iniciarla', async () => {
    const s4 = await sec49();
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: l1, secadora_id: s4 }],
    });
    expect(await total(nota.id)).toBe(70);
    await api('post', `/api/notas/${nota.id}/abonos`, { monto: 30, forma_pago: 'EFECTIVO' }).expect(201);
    const liquida = await api('post', `/api/notas/${nota.id}/abonos`, { monto: 40, forma_pago: 'EFECTIVO' });
    expect(liquida.status).toBe(409);
    const pagar = await api('patch', `/api/notas/${nota.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(pagar.status).toBe(409);
    expect(pagar.body.message).toMatch(/Inicia la secadora S4/);

    await iniciar(nota.id, s4, 10).expect(200);
    await api('patch', `/api/notas/${nota.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
  });
});

describe('Por Encargo: el programa no cambia el costo', () => {
  it('la secadora va en el servicio aunque se elija el programa más largo', async () => {
    const s4 = await sec49();
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', tamano: 'chico',
      cargas: [{ secadora_tipo: 'mediana', tamano: 'chico' }],
    });
    const antes = await total(nota.id);
    await api('patch', `/api/notas/${nota.id}/asignar-carga-maquina`,
      { carga_id: nota.cargas[0].id, slot: 'secadora', maquina_id: s4 }).expect(200);
    expect((await carga(nota.id)).secadora_por_definir).toBe(false);
    await iniciar(nota.id, s4, 30).expect(200);
    expect(await total(nota.id)).toBe(antes);
    // Otra ficha tampoco cobra.
    await api('patch', `/api/maquinas/${s4}/otra-ficha`, { nota_id: nota.id }).expect(200);
    expect(await total(nota.id)).toBe(antes);
  });
});

describe('Más secado y Relavado solo en Por Encargo', () => {
  it('Autoservicio no admite Más secado', async () => {
    const s1 = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const { body: nota } = await notaAuto(s1);
    await iniciar(nota.id, s1).expect(200);
    await api('patch', `/api/notas/${nota.id}/terminar-secado`, { secadora_id: s1 });
    const res = await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [s1], carga_id: nota.cargas[0].id, cobrar: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Más secado/);
  });

  it('Por Encargo sí, sin costo, y la Sec49 pregunta el programa', async () => {
    const s4 = await sec49();
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', tamano: 'chico',
      cargas: [{ secadora_tipo: 'mediana', tamano: 'chico' }],
    });
    const c = nota.cargas[0];
    await api('patch', `/api/notas/${nota.id}/asignar-carga-maquina`,
      { carga_id: c.id, slot: 'secadora', maquina_id: s4 }).expect(200);
    await iniciar(nota.id, s4, 10).expect(200);
    await api('patch', `/api/notas/${nota.id}/terminar-secado`, { secadora_id: s4 }).expect(200);
    const antes = await total(nota.id);
    await api('patch', `/api/notas/${nota.id}/asignar-maquina`,
      { maquina_ids: [s4], carga_id: c.id, cobrar: false }).expect(200);
    await iniciar(nota.id, s4, 20).expect(200);
    expect(await total(nota.id)).toBe(antes);
    const { rows } = await pool.query('SELECT ciclo_elegido_minutos FROM maquinas WHERE id = $1', [s4]);
    expect(rows[0].ciclo_elegido_minutos).toBe(20);
  });
});

describe('Más fichas: se elige uno de los tiempos con su costo', () => {
  const masFichas = (id, body) => api('patch', `/api/maquinas/${id}/otra-ficha`, body);
  const fichas = async (notaId) => (await pool.query(
    'SELECT fichas_extra, precio_fichas_extra FROM nota_cargas WHERE nota_id = $1', [notaId])).rows[0];
  const elegido = async (id) =>
    (await pool.query('SELECT ciclo_elegido_minutos FROM maquinas WHERE id = $1', [id])).rows[0].ciclo_elegido_minutos;

  it('Autoservicio: 20 min más cobran $40 y cuentan 2 fichas', async () => {
    const s4 = await sec49();
    const { body: nota } = await notaAuto(s4);
    await iniciar(nota.id, s4, 10).expect(200);
    await masFichas(s4, { nota_id: nota.id, minutos: 20 }).expect(200);
    expect(await elegido(s4)).toBe(30);
    const f = await fichas(nota.id);
    expect(f.fichas_extra).toBe(2);
    expect(Number(f.precio_fichas_extra)).toBe(40);
    expect(await total(nota.id)).toBe(20 + 40);
  });

  it('un tiempo sin precio se cobra a costo por ficha', async () => {
    const s4 = await sec49([20, null, 50]);
    await pool.query("UPDATE modelos_maquina SET precio_por_ficha = 15 WHERE nombre = 'Sec49'");
    const { body: nota } = await notaAuto(s4);
    await iniciar(nota.id, s4, 10).expect(200);
    await masFichas(s4, { nota_id: nota.id, minutos: 20 }).expect(200);
    expect(Number((await fichas(nota.id)).precio_fichas_extra)).toBe(30);
  });

  it('un tiempo que el modelo no ofrece se rechaza', async () => {
    const s4 = await sec49();
    const { body: nota } = await notaAuto(s4);
    await iniciar(nota.id, s4, 10).expect(200);
    expect((await masFichas(s4, { nota_id: nota.id, minutos: 15 })).status).toBe(400);
  });

  it('Por Encargo: suma el tiempo sin cobrar', async () => {
    const s4 = await sec49();
    const { body: nota } = await api('post', '/api/notas', {
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', tamano: 'chico',
      cargas: [{ secadora_tipo: 'mediana', tamano: 'chico' }],
    });
    await api('patch', `/api/notas/${nota.id}/asignar-carga-maquina`,
      { carga_id: nota.cargas[0].id, slot: 'secadora', maquina_id: s4 }).expect(200);
    await iniciar(nota.id, s4, 10).expect(200);
    const antes = await total(nota.id);
    await masFichas(s4, { nota_id: nota.id, minutos: 30 }).expect(200);
    expect(await elegido(s4)).toBe(40);
    expect(await total(nota.id)).toBe(antes);
    expect((await fichas(nota.id)).fichas_extra).toBe(3);
  });
});
