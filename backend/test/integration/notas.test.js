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
  it('nace En Espera con el tipo de máquina elegido, sin máquina asignada', async () => {
    const clienteId = await seedCliente({ nombre: 'Ana', apellido: 'López' });

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO',
      cliente_id: clienteId,
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      tiempo_entrega: 'TARDE',
      cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('POR_ENCARGO');
    expect(res.body.estado).toBe('EN_ESPERA');
    expect(res.body.estado_pago).toBe('PENDIENTE');
    expect(res.body.cliente_id).toBe(clienteId);
    // No se reserva máquina: la carga guarda el tipo previsto, sin lavadora_id.
    // Precio derivado del tipo mediana (tarifa default 70).
    expect(res.body.cargas).toHaveLength(1);
    expect(res.body.cargas[0].lavadora_id).toBeNull();
    expect(res.body.cargas[0].lavadora_tipo).toBe('mediana');
    expect(Number(res.body.precio_total)).toBe(70);

    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.body.cliente_nombre).toBe('Ana');
    // El detalle expone el tipo previsto para asignar la máquina en Salidas.
    expect(detalle.body.cargas[0].lavadora_tipo_previsto).toBe('mediana');
    expect(detalle.body.cargas[0].lavadora_id).toBeNull();
  });

  it('asignar-carga-maquina pone la máquina en la carga (y rechaza otro tipo)', async () => {
    const clienteId = await seedCliente();
    const lavMed = await seedMaquina({ nombre: 'Lav Mediana', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const lavJum = await seedMaquina({ nombre: 'Lav Jumbo', tipo: 'lavadora_jumbo', tamano: 'jumbo' });

    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    const cargaId = nota.body.cargas[0].id;

    // Rechaza una lavadora jumbo en un slot mediana.
    const malo = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavJum });
    expect(malo.status).toBe(400);

    // Asigna la lavadora mediana correcta.
    const ok = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavMed });
    expect(ok.status).toBe(200);
    expect(ok.body.cargas[0].lavadora_id).toBe(lavMed);
    expect(ok.body.cargas[0].lavadora_nombre).toBe('Lav Mediana');
    // La máquina queda asignada En Espera (no se arranca sola).
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavMed]);
    expect(rows[0].estado).toBe('disponible');
    expect(ok.body.estado).toBe('EN_ESPERA');
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

  it('con tope, el precio de la carga es el tope (100), aunque máquinas cuesten 70', async () => {
    const { clienteId, lavadoraId } = await armar();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, tamano: 'grande', activar: false }],
    });
    expect(res.status).toBe(201);
    // Precio fijo por carga: la carga grande cuesta su tope (100), no las
    // máquinas (70). El costo interno 70 ≤ 100, así que se crea.
    expect(Number(res.body.precio_total)).toBe(100);
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

describe('handlers de máquina — asignar / cambiar / quitar', () => {
  // Nota Por Encargo En Espera: la lavadora queda asignada pero disponible
  // (sin iniciar), que es el estado que exigen cambiar y quitar máquina.
  async function porEncargoEnEspera() {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, activar: false }],
    });
    return { notaId: res.body.id, lavadoraId };
  }

  it('asignar-maquina agrega una carga nueva y suma su tarifa', async () => {
    const { notaId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: true });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(2);
    expect(Number(res.body.precio_total)).toBe(140); // 70 + 70
    // La máquina agregada queda asignada pero sin iniciar (disponible).
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [otra]);
    expect(rows[0].estado).toBe('disponible');
  });

  it('asignar-maquina exige el flag cobrar', async () => {
    const { notaId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora 2' });
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cobrar/i);
  });

  it('asignar-secadora agrega el secado a la carga y ocupa la secadora', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const secadoraId = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-secadora`)
      .set(auth(admin.token)).send({ secadora_id: secadoraId });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(115); // 70 lavado + 45 secado
    expect(res.body.cargas[0].secadora_id).toBe(secadoraId);
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [secadoraId]);
    expect(rows[0].estado).toBe('en_uso');
  });

  it('cambiar-maquina reemplaza una lavadora sin iniciar por otra disponible', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const nueva = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/cambiar-maquina`)
      .set(auth(admin.token)).send({ maquina_actual_id: lavadoraId, maquina_nueva_id: nueva });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].lavadora_id).toBe(nueva);
    // La anterior vuelve a estar libre, la nueva sigue asignada sin iniciar.
    const { rows } = await pool.query('SELECT id, estado FROM maquinas ORDER BY id');
    expect(rows.find(m => m.id === lavadoraId).estado).toBe('disponible');
    expect(rows.find(m => m.id === nueva).estado).toBe('disponible');
  });

  it('cambiar-maquina rechaza cambiar a una máquina de otro tipo', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const secadora = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/cambiar-maquina`)
      .set(auth(admin.token)).send({ maquina_actual_id: lavadoraId, maquina_nueva_id: secadora });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mismo tipo/i);
  });

  it('quitar-maquina desasigna una lavadora sin iniciar y pone su precio en 0', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const res = await request(app).patch(`/api/notas/${notaId}/quitar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId });
    expect(res.status).toBe(200);
    expect(res.body.cargas[0].lavadora_id).toBeNull();
    expect(Number(res.body.cargas[0].precio_lavadora)).toBe(0);
    expect(Number(res.body.precio_total)).toBe(0);
    // La máquina liberada sigue disponible para otra nota.
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('disponible');
  });

  it('no se puede quitar una máquina que ya arrancó (en uso)', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/quitar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no ha iniciado/i);
  });
});

describe('PATCH /api/notas/:id — edición', () => {
  async function autoservicio({ estado_pago = 'PENDIENTE', productos } = {}) {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago,
      instrucciones: 'Original', cargas: [{ lavadora_id: lavadoraId, activar: true }],
      ...(productos ? { productos } : {}),
    });
    return { notaId: res.body.id, lavadoraId };
  }

  it('es un PATCH real: los campos ausentes conservan su valor', async () => {
    const { notaId } = await autoservicio();
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ ajuste: 10 });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(80);   // 70 carga + 10 ajuste
    expect(res.body.instrucciones).toBe('Original');    // no se tocó
    expect(res.body.estado_pago).toBe('PENDIENTE');     // no se tocó
    expect(res.body.cargas).toHaveLength(1);
  });

  it('no se puede editar una nota cancelada', async () => {
    const { notaId } = await autoservicio();
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA' }).expect(200);
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ instrucciones: 'tarde' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no se puede editar/i);
  });

  it('revertir un pago desde la edición es solo para admin', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const { notaId } = await autoservicio({ estado_pago: 'PAGADO' });

    // El empleado no puede revertir el pago.
    const bloqueado = await request(app).patch(`/api/notas/${notaId}`)
      .set(auth(empleado.token)).send({ estado_pago: 'PENDIENTE' });
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.message).toMatch(/administrador/i);

    // El admin sí.
    const ok = await request(app).patch(`/api/notas/${notaId}`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE' });
    expect(ok.status).toBe(200);
    expect(ok.body.estado_pago).toBe('PENDIENTE');
  });

  it('productos que no es lista → 400', async () => {
    const { notaId } = await autoservicio();
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ productos: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/productos/i);
  });

  it('estado_pago inválido → 400', async () => {
    const { notaId } = await autoservicio();
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ estado_pago: 'X' });
    expect(res.status).toBe(400);
  });

  it('reemplazar los productos libera el stock viejo y reserva el nuevo', async () => {
    const viejo = await seedProducto({ nombre: 'Viejo', precio_unitario: 20, stock_actual: 50 });
    const nuevo = await seedProducto({ nombre: 'Nuevo', precio_unitario: 35, stock_actual: 50 });
    const { notaId } = await autoservicio({ productos: [{ producto_id: viejo, cantidad: 2 }] });

    // Al crear se reservaron 2 del viejo.
    let r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [viejo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(2);

    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ productos: [{ producto_id: nuevo, cantidad: 1 }] });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(105); // 70 carga + 35 nuevo

    r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [viejo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(0);  // liberado
    r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [nuevo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(1);  // reservado
  });

  it('un ajuste que deja el total negativo → 400', async () => {
    const { notaId } = await autoservicio();
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ ajuste: -1000 }); // 70 - 1000 < 0
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no puede ser negativo/i);
  });

  it('editar cargas también respeta el tope de precio', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const productoId = await seedProducto({ precio_unitario: 40 });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, tamano: 'grande', activar: false }],
    });
    // Editar la carga metiéndole un producto que la pasa del tope (70 + 40 > 100).
    const res = await request(app).patch(`/api/notas/${creada.body.id}`).set(auth(admin.token))
      .send({ cargas: [{ lavadora_id: lavadoraId, tamano: 'grande', activar: false,
                         productos: [{ producto_id: productoId, cantidad: 1 }] }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rebasa el tope/i);
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

describe('cargas múltiples', () => {
  it('crea una nota con dos cargas y toma ambas lavadoras', async () => {
    const lav1 = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const lav2 = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [
        { lavadora_id: lav1, activar: true },
        { lavadora_id: lav2, activar: true },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.cargas).toHaveLength(2);
    expect(Number(res.body.precio_total)).toBe(140); // 70 + 70
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = ANY($1)', [[lav1, lav2]]);
    expect(rows.every(m => m.estado === 'en_uso')).toBe(true);
  });

  it('activar-pendientes con maquina_id arranca solo esa máquina', async () => {
    const clienteId = await seedCliente();
    const lav1 = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const lav2 = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [
        { lavadora_id: lav1, activar: false },
        { lavadora_id: lav2, activar: false },
      ],
    });
    expect(creada.body.estado).toBe('EN_ESPERA');

    const res = await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`)
      .set(auth(admin.token)).send({ maquina_id: lav1 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LAVANDO');
    const { rows } = await pool.query('SELECT id, estado FROM maquinas ORDER BY id');
    expect(rows.find(m => m.id === lav1).estado).toBe('en_uso');
    expect(rows.find(m => m.id === lav2).estado).toBe('disponible');
  });
});

describe('edredón (lavadora jumbo)', () => {
  it('tarifa el lavado de edredón con la tarifa jumbo de edredón', async () => {
    const clienteId = await seedCliente();
    const jumbo = await seedMaquina({ nombre: 'Jumbo 1', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: jumbo, activar: false }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(80); // edredonJumbo (default)
    expect(Number(res.body.cargas[0].precio_lavadora)).toBe(80);
  });

  it('rechaza edredón en una lavadora que no es jumbo', async () => {
    const clienteId = await seedCliente();
    const mediana = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: mediana, activar: false }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/jumbo/i);
  });

  it('aplica el tope de edredón (lavado 80 + producto 90 > 160)', async () => {
    await seedAjustes({ precio_edredon_jumbo: 80, tope_carga_edredon: 160 });
    const clienteId = await seedCliente();
    const jumbo = await seedMaquina({ nombre: 'Jumbo 1', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const productoId = await seedProducto({ precio_unitario: 90 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE',
      // La prenda va en la carga (como la manda el frontend): así validarTopesCargas
      // la reconoce como edredón y aplica el tope dedicado.
      cargas: [{ lavadora_id: jumbo, tipo_prenda: 'EDREDON', activar: false,
                 productos: [{ producto_id: productoId, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rebasa el tope/i);
  });
});

describe('productos por tapa', () => {
  it('en Por Encargo el producto por tapa se cobra (cuenta al total) y reserva stock', async () => {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const tapa = await seedProducto({ nombre: 'Suavizante', precio_unitario: 15, es_por_tapa: true });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, activar: false }],
      productos: [{ producto_id: tapa, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    // Sin tope (la carga no tiene tamaño): suma real. La tapa ya no va gratis:
    // 70 lavado + 2×15 tapa = 100.
    expect(Number(res.body.precio_total)).toBe(100);
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [tapa]);
    expect(Number(rows[0].stock_reservado)).toBe(2);
  });

  it('en Autoservicio el producto por tapa sí se cobra', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const tapa = await seedProducto({ nombre: 'Suavizante', precio_unitario: 15, es_por_tapa: true });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
      productos: [{ producto_id: tapa, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(100); // 70 lavado + 2×15 tapa
  });
});

describe('cancelar nota', () => {
  it('cancelar devuelve el stock reservado y libera las máquinas', async () => {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const productoId = await seedProducto({ precio_unitario: 30, stock_actual: 10 });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_id: lavadoraId, activar: false }],
      productos: [{ producto_id: productoId, cantidad: 3 }],
    });
    let prod = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [productoId]);
    expect(Number(prod.rows[0].stock_reservado)).toBe(3); // se reservó al crear

    const res = await request(app).patch(`/api/notas/${creada.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');

    prod = await pool.query('SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [productoId]);
    expect(Number(prod.rows[0].stock_reservado)).toBe(0);  // reserva devuelta
    expect(Number(prod.rows[0].stock_actual)).toBe(10);    // intacto: nunca se consumió
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('disponible');
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
