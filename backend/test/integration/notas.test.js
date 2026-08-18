import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina,
  seedCliente, seedProducto, seedAjustes, auth,
} from '../helpers.js';

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

describe('POST /api/notas — Por Encargo', () => {
  it('nace En Espera con cliente cuando la carga no se activa', async () => {
    const clienteId = await seedCliente({ nombre: 'Ana', apellido: 'López' });
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO',
      cliente_id: clienteId,
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      tiempo_entrega: 'TARDE',
      cargas: [{ lavadora_id: lavadoraId, activar: false }],
    });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('POR_ENCARGO');
    expect(res.body.estado).toBe('EN_ESPERA');
    expect(res.body.estado_pago).toBe('PENDIENTE');
    expect(res.body.cliente_id).toBe(clienteId);
    // La carga no se activó: la lavadora queda asignada pero libre.
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('disponible');

    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.body.cliente_nombre).toBe('Ana');
  });

  it('tiempo_entrega inválido → 400', async () => {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', tiempo_entrega: 'NORMAL',
      cargas: [{ lavadora_id: lavadoraId, activar: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tiempo_entrega/i);
  });

  it('cliente de otra sucursal → 400', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedCliente({ sucursal: 'norte' });
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1' });
    const res = await request(app).post('/api/notas').set(auth(admin.token, 'centro')).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: ajeno, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, activar: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cliente_id/i);
  });
});

describe('topes de precio por carga (solo Por Encargo)', () => {
  // Tope de $100 para el tamaño "grande"; lavadora mediana tarifa 70.
  async function armar() {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    return { clienteId, lavadoraId };
  }

  it('una carga dentro del tope se crea (máquinas 70 ≤ 100)', async () => {
    const { clienteId, lavadoraId } = await armar();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, tamano: 'grande', activar: false }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(70);
  });

  it('un producto que rebasa el tope → 400 y no crea la nota', async () => {
    const { clienteId, lavadoraId } = await armar();
    const productoId = await seedProducto({ precio_unitario: 40 }); // 70 + 40 = 110 > 100
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, tamano: 'grande', activar: false,
                 productos: [{ producto_id: productoId, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rebasa el tope/i);
    // Rollback: ni la nota ni la reserva de stock quedaron.
    const { rows: notas } = await pool.query('SELECT COUNT(*)::int c FROM notas');
    expect(notas[0].c).toBe(0);
    const { rows: prod } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [productoId]);
    expect(Number(prod[0].stock_reservado)).toBe(0);
  });

  it('el tope no aplica a Autoservicio (misma máquina, sin tamaño)', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 50 });
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    expect(res.status).toBe(201); // 70 > 50 pero autoservicio no tiene tope
  });
});

describe('handlers de máquina — ciclo de vida', () => {
  async function autoservicioLavando() {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const secadoraId = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    return { notaId: res.body.id, lavadoraId, secadoraId };
  }

  it('terminar-lavado pasa la carga a la secadora, cobra el secado y libera la lavadora', async () => {
    const { notaId, lavadoraId, secadoraId } = await autoservicioLavando();

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado`)
      .set(auth(admin.token)).send({ lavadora_id: lavadoraId, secadora_id: secadoraId });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('SECANDO');
    expect(Number(res.body.precio_total)).toBe(115); // 70 lavado + 45 secado

    const { rows } = await pool.query('SELECT id, estado FROM maquinas ORDER BY id');
    expect(rows.find(m => m.id === lavadoraId).estado).toBe('disponible');
    expect(rows.find(m => m.id === secadoraId).estado).toBe('en_uso');
  });

  it('terminar-secado deja la nota Lista y libera la secadora', async () => {
    const { notaId, lavadoraId, secadoraId } = await autoservicioLavando();
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado`)
      .set(auth(admin.token)).send({ lavadora_id: lavadoraId, secadora_id: secadoraId }).expect(200);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-secado`)
      .set(auth(admin.token)).send({ secadora_id: secadoraId });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [secadoraId]);
    expect(rows[0].estado).toBe('disponible');
  });

  it('no se puede finalizar una nota pendiente de pago; sí tras liquidarla', async () => {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    const notaId = creada.body.id;

    // LAVANDO → LISTA (transición válida sin pasar por secado).
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'LISTA' }).expect(200);

    // Finalizar estando PENDIENTE: bloqueado.
    const bloqueada = await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' });
    expect(bloqueada.status).toBe(400);
    expect(bloqueada.body.message).toMatch(/pendiente de pago/i);

    // Liquidar y finalizar.
    await request(app).patch(`/api/notas/${notaId}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO' }).expect(200);
    const ok = await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' });
    expect(ok.status).toBe(200);
    expect(ok.body.estado).toBe('FINALIZADA');
  });

  it('respeta la máquina de estados (transición inválida → 400)', async () => {
    const { notaId } = await autoservicioLavando(); // estado LAVANDO
    const res = await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' }); // LAVANDO ↛ FINALIZADA
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Transición no válida/i);
  });
});

describe('permisos por rol', () => {
  it('un empleado no puede eliminar una nota (403); un admin sí (204)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    const notaId = creada.body.id;

    await request(app).delete(`/api/notas/${notaId}`).set(auth(empleado.token)).expect(403);
    await request(app).delete(`/api/notas/${notaId}`).set(auth(admin.token)).expect(204);
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
