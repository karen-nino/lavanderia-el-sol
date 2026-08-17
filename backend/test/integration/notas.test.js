import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('POST /api/notas — validaciones', () => {
  const base = { tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE' };

  it('tipo_servicio inválido → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Tipo de servicio inválido/i);
  });

  it('estado_pago inválido → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'AUTOSERVICIO', estado_pago: 'X' });
    expect(res.status).toBe(400);
  });

  it('Por Encargo sin cliente_id → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'POR_ENCARGO' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cliente_id/i);
  });

  it('cargas vacías → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'AUTOSERVICIO', cargas: [] });
    expect(res.status).toBe(400);
  });

  it('carga con una máquina inexistente → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'AUTOSERVICIO', cargas: [{ lavadora_id: 999999, activar: true }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/notas — Autoservicio (happy path)', () => {
  it('crea la nota, tarifica la carga y pone la lavadora en uso', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('AUTOSERVICIO');
    expect(res.body.estado).toBe('LAVANDO');
    expect(res.body.folio).toMatch(/^\d{4}-\d{6}$/);
    // Una carga, lavadora mediana (tarifa default 70), sin secadora ni ajuste.
    expect(res.body.cargas).toHaveLength(1);
    expect(Number(res.body.precio_total)).toBe(70);

    // La lavadora quedó en uso.
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('en_uso');

    // Se puede leer de vuelta y aparece en el listado.
    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.status).toBe(200);
    expect(detalle.body.folio).toBe(res.body.folio);

    const lista = await request(app).get('/api/notas').set(auth(admin.token));
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
  });

  it('no permite tomar una máquina ya reservada por otra nota', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1' });
    const cargas = [{ lavadora_id: lavadoraId, activar: true }];
    const body = { tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', cargas };

    await request(app).post('/api/notas').set(auth(admin.token)).send(body).expect(201);
    const segunda = await request(app).post('/api/notas').set(auth(admin.token)).send(body);
    expect(segunda.status).toBe(400);
  });
});

describe('lecturas del modelo por cargas (invariantes que deben sobrevivir el refactor)', () => {
  async function crearAutoservicio() {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    return { notaId: res.body.id, lavadoraId };
  }

  it('getNotaById devuelve las cargas con la info de su lavadora', async () => {
    const { notaId, lavadoraId } = await crearAutoservicio();
    const res = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(1);
    expect(res.body.cargas[0].lavadora_id).toBe(lavadoraId);
    expect(res.body.cargas[0].lavadora_nombre).toBe('Lavadora 1');
    expect(res.body.cargas[0].lavadora_estado).toBe('en_uso');
  });

  it('getNotas marca hay_lavadora_activa cuando una lavadora corre', async () => {
    await crearAutoservicio();
    const res = await request(app).get('/api/notas').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].hay_lavadora_activa).toBe(true);
    expect(res.body[0].hay_secadora_activa).toBe(false);
    expect(res.body[0].maquinas_nombres).toContain('Lavadora 1');
  });

  it('PATCH edita un campo simple conservando las cargas', async () => {
    const { notaId } = await crearAutoservicio();
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ instrucciones: 'Sin suavizante' });
    expect(res.status).toBe(200);
    expect(res.body.instrucciones).toBe('Sin suavizante');
    expect(res.body.cargas).toHaveLength(1);
  });

  it('PATCH reemplaza las cargas y retarifica', async () => {
    const { notaId } = await crearAutoservicio();
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ cargas: [{ lavadora_id: otra, activar: true }] });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(1);
    expect(res.body.cargas[0].lavadora_id).toBe(otra);
    // La lavadora anterior se liberó, la nueva quedó en uso.
    const { rows } = await pool.query('SELECT nombre, estado FROM maquinas ORDER BY id');
    expect(rows.find(m => m.nombre === 'Lavadora 1').estado).toBe('disponible');
    expect(rows.find(m => m.nombre === 'Lavadora 2').estado).toBe('en_uso');
  });
});

describe('aislamiento por sucursal', () => {
  it('una máquina de otra sucursal no es usable (400)', async () => {
    await seedSucursal('norte', 'Norte');
    const ajena = await seedMaquina({ nombre: 'Ajena', sucursal: 'norte' });

    const res = await request(app).post('/api/notas').set(auth(admin.token, 'centro')).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: ajena, activar: true }],
    });
    expect(res.status).toBe(400);
  });
});
