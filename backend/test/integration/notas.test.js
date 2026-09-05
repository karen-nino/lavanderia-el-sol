import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import pool from '../../db/pool.js';
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
    expect(res.body.message).toMatch(/tipo de servicio válido/i);
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
    expect(res.body.message).toMatch(/cliente/i);
  });

  it('cargas vacías → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'AUTOSERVICIO', cargas: [] });
    expect(res.status).toBe(400);
  });

  it('carga sin tipo de lavado ni secado → 400', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ ...base, tipo_servicio: 'AUTOSERVICIO', cargas: [{ tipo_prenda: 'ROPA' }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/notas — Autoservicio (happy path)', () => {
  it('crea la nota con tipo de lavado, sin máquina, y tarifa por tipo', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('AUTOSERVICIO');
    // Nace En Espera SIN máquina: la física se asigna después en Salidas.
    expect(res.body.estado).toBe('EN_ESPERA');
    expect(res.body.folio).toMatch(/^\d{4}-\d{6}$/);
    expect(res.body.cargas).toHaveLength(1);
    expect(res.body.cargas[0].lavadora_id).toBeNull();
    expect(res.body.cargas[0].lavadora_tipo).toBe('mediana');
    expect(Number(res.body.precio_total)).toBe(70); // tarifa mediana

    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.status).toBe(200);
    expect(detalle.body.folio).toBe(res.body.folio);
    expect(detalle.body.cargas[0].lavadora_tipo_previsto).toBe('mediana');

    const lista = await request(app).get('/api/notas').set(auth(admin.token));
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
  });
});

describe('lecturas del modelo por cargas (invariantes que deben sobrevivir el refactor)', () => {
  async function crearAutoservicio() {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const cargaId = crea.body.cargas[0].id;
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });
    return { notaId: crea.body.id, lavadoraId };
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

  it('PATCH reemplaza las cargas que no han arrancado y las retarifica', async () => {
    // Nota recién creada: su carga todavía no pasa por ninguna máquina.
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const res = await request(app).patch(`/api/notas/${crea.body.id}`).set(auth(admin.token))
      .send({ cargas: [{ lavadora_tipo: 'jumbo' }] });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(1);
    // El PATCH ahora responde las cargas con el mismo formato que GET /notas/:id,
    // donde el tipo elegido en la nota viaja como lavadora_tipo_previsto
    // (lavadora_tipo es el de la máquina física, que aquí todavía no hay).
    expect(res.body.cargas[0].lavadora_tipo_previsto).toBe('jumbo');
  });

  it('PATCH no borra una carga que está lavando ni suelta su máquina', async () => {
    const { notaId } = await crearAutoservicio();
    // Mandar la lista sin esa carga la borraría junto con su historial.
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ cargas: [{ lavadora_tipo: 'jumbo' }] });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya se procesó/i);

    // La lavadora sigue girando: antes esta edición la dejaba libre.
    const { rows } = await pool.query('SELECT nombre, estado FROM maquinas ORDER BY id');
    expect(rows.find(m => m.nombre === 'Lavadora 1').estado).toBe('en_uso');
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
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', tiempo_entrega: 'NORMAL',
      cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cuándo se entrega/i);
  });

  it('cliente de otra sucursal → 400', async () => {
    await seedSucursal('norte', 'Norte');
    const ajeno = await seedCliente({ sucursal: 'norte' });
    const res = await request(app).post('/api/notas').set(auth(admin.token, 'centro')).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: ajeno, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cliente/i);
  });
});

// Asignar una máquina NO la aparta: mientras nadie la arranque, varias notas
// pueden tenerla asignada. La primera que le da a "Iniciar" se la queda; las
// demás reciben un aviso para cambiarla por otra.
describe('quién se queda con la máquina: la primera que inicia', () => {
  const crearConTipo = () => request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  const asignarACarga = (notaId, cargaId, maquinaId) =>
    request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: maquinaId });
  const iniciar = (notaId, maquinaId) =>
    request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: maquinaId });

  it('dos notas pueden tener asignada la misma lavadora mientras esté libre', async () => {
    const lav = await seedMaquina({ nombre: 'L-compartida', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);
  });

  it('la primera en iniciar se la queda; la otra recibe 409 con el folio', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);

    await iniciar(a.id, lav).expect(200);           // A llegó primero

    const res = await iniciar(b.id, lav);           // B llega tarde
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya la está usando la nota/i);
    expect(res.body.message).toMatch(new RegExp(a.folio));   // dice quién la tiene
    expect(res.body.message).toMatch(/cámbiala/i);           // y qué hacer
  });

  it('dos "Iniciar" simultáneos: solo uno arranca', async () => {
    const lav = await seedMaquina({ nombre: 'L-race', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);

    const res = await Promise.all([iniciar(a.id, lav), iniciar(b.id, lav)]);
    expect(res.filter(r => r.status === 200)).toHaveLength(1);
    expect(res.filter(r => r.status === 409)).toHaveLength(1);
  });

  // Tener la máquina asignada no es lo mismo que estarla usando: si no se
  // distinguen, la nota que solo la tenía asignada apaga la lavadora de la que
  // sí la está usando (con Sonoff, a media lavada).
  it('cancelar la nota que NO la arrancó no apaga la lavadora de la que sí', async () => {
    const lav = await seedMaquina({ nombre: 'L-cancel', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);
    await iniciar(a.id, lav).expect(200);

    await request(app).patch(`/api/notas/${b.id}/estado`).set(auth(admin.token))
      .send({ estado: 'CANCELADA' }).expect(200);

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lav]);
    expect(rows[0].estado).toBe('en_uso');   // A sigue lavando
  });

  it('eliminar la nota que NO la arrancó tampoco la apaga', async () => {
    const lav = await seedMaquina({ nombre: 'L-borrar', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);
    await iniciar(a.id, lav).expect(200);

    await request(app).delete(`/api/notas/${b.id}`).set(auth(admin.token)).expect(204);

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lav]);
    expect(rows[0].estado).toBe('en_uso');
  });

  // Al arrancar el secado, la lavadora de esa carga se da por terminada y se
  // libera. Si la carga solo la tenía asignada y quien la está usando es otra
  // nota, liberarla cortaba esa lavada a media (y con Sonoff, apagaba la
  // máquina físicamente).
  it('arrancar mi secadora no libera la lavadora que usa otra nota', async () => {
    const lav = await seedMaquina({ nombre: 'L-ajena', tipo: 'lavadora_mediana' });
    const sec = await seedMaquina({ nombre: 'S-propia', tipo: 'secadora' });

    const a = (await crearConTipo()).body;   // la va a usar de verdad
    // B tiene la misma lavadora asignada (aún libre) y además su secadora.
    const b = (await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', secadora_tipo: 'mediana' }],
    })).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);
    await request(app).patch(`/api/notas/${b.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: b.cargas[0].id, slot: 'secadora', maquina_id: sec }).expect(200);

    await iniciar(a.id, lav).expect(200);    // A se queda la lavadora
    await iniciar(b.id, sec).expect(200);    // B arranca solo su secadora

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lav]);
    expect(rows[0].estado).toBe('en_uso');   // la lavada de A sigue viva
    const notaA = await pool.query('SELECT estado FROM notas WHERE id = $1', [a.id]);
    expect(notaA.rows[0].estado).toBe('LAVANDO');
    // Y B no se cuenta como lavando: solo tiene la lavadora asignada.
    const notaB = await pool.query('SELECT estado FROM notas WHERE id = $1', [b.id]);
    expect(notaB.rows[0].estado).toBe('SECANDO');
  });

  it('la nota que perdió puede cambiar a otra lavadora y arrancarla', async () => {
    const lav = await seedMaquina({ nombre: 'L-ocupada', tipo: 'lavadora_mediana' });
    const otra = await seedMaquina({ nombre: 'L-libre', tipo: 'lavadora_mediana' });
    const a = (await crearConTipo()).body;
    const b = (await crearConTipo()).body;
    await asignarACarga(a.id, a.cargas[0].id, lav).expect(200);
    await asignarACarga(b.id, b.cargas[0].id, lav).expect(200);
    await iniciar(a.id, lav).expect(200);

    await request(app).patch(`/api/notas/${b.id}/cambiar-maquina`).set(auth(admin.token))
      .send({ maquina_actual_id: lav, maquina_nueva_id: otra }).expect(200);
    await iniciar(b.id, otra).expect(200);
  });
});

// Un cobro vale para el costo que tenía la nota en ese momento: si después se
// le agrega (o se le quita) una máquina o un producto y el total se mueve, el
// pago deja de corresponder y la nota vuelve a PENDIENTE para cobrarla por el
// importe nuevo.
describe('un cambio de costo desmarca el pago', () => {
  it('agregar una máquina cobrada a una nota PAGADA la deja PENDIENTE', async () => {
    const creada = await crearNotaAuto('L1', 'PAGADO');
    expect(creada.body.estado_pago).toBe('PAGADO');
    const total = Number(creada.body.precio_total);

    const secadoraId = await seedMaquina({ nombre: 'S-cambio', tipo: 'secadora' });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: true });

    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBeGreaterThan(total);
    expect(res.body.estado_pago).toBe('PENDIENTE');
    expect(res.body.forma_pago).toBeNull();
    // Sale del corte de caja hasta que se vuelva a cobrar.
    expect(res.body.pagado_en).toBeNull();
  });

  it('una máquina SIN cobro no mueve el total y respeta el pago', async () => {
    const creada = await crearNotaAuto('L2', 'PAGADO');
    const total = Number(creada.body.precio_total);

    const secadoraId = await seedMaquina({ nombre: 'S-gratis', tipo: 'secadora' });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: false });

    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(total);
    expect(res.body.estado_pago).toBe('PAGADO');
  });

  it('una nota PENDIENTE sigue pendiente (no hay pago que deshacer)', async () => {
    const creada = await crearNotaAuto('L3', 'PENDIENTE');
    const secadoraId = await seedMaquina({ nombre: 'S-pend', tipo: 'secadora' });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: true });
    expect(res.status).toBe(200);
    expect(res.body.estado_pago).toBe('PENDIENTE');
  });

  it('deja aviso en la campana con los dos importes', async () => {
    const creada = await crearNotaAuto('L4', 'PAGADO');
    const secadoraId = await seedMaquina({ nombre: 'S-aviso', tipo: 'secadora' });
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: true }).expect(200);

    const avisos = await request(app).get('/api/notificaciones').set(auth(admin.token));
    const aviso = (avisos.body ?? []).find(n => n.tipo === 'pago_desmarcado');
    expect(aviso).toBeTruthy();
    expect(aviso.mensaje).toMatch(/PENDIENTE de cobro/);
  });
});

// Nota de autoservicio con una lavadora mediana ya asignada (tarifa 70).
async function crearNotaAuto(nombreMaquina, estado_pago) {
  await seedAjustes({ precio_carga_mediana: 70, precio_carga_secadora: 45 });
  const lavadoraId = await seedMaquina({ nombre: nombreMaquina, tipo: 'lavadora_mediana' });
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
    estado_pago, ...(estado_pago === 'PAGADO' ? { forma_pago: 'EFECTIVO' } : {}),
    cargas: [{ lavadora_id: lavadoraId, lavadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  return creada;
}

describe('topes de precio por carga (solo Por Encargo)', () => {
  // Tope de $100 para el tamaño "grande"; lavado mediana tarifa 70.
  async function armar() {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 100 });
    const clienteId = await seedCliente();
    return { clienteId };
  }

  it('con tope, el precio de la carga es el tope (100), aunque máquinas cuesten 70', async () => {
    const { clienteId } = await armar();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(201);
    // Precio fijo por carga: la carga grande cuesta su tope (100), no las
    // máquinas (70). El costo interno 70 ≤ 100, así que se crea.
    expect(Number(res.body.precio_total)).toBe(100);
  });

  it('un producto que rebasa el tope → 400 y no crea la nota', async () => {
    const { clienteId } = await armar();
    const productoId = await seedProducto({ precio_unitario: 40 }); // 70 + 40 = 110 > 100
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
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

  // Regresión: el tope se congela en la carga (mig. 096). Antes se leía el
  // vigente en Ajustes en cada recálculo, así que subir los precios re-tarifaba
  // notas viejas: una nota cobrada en $150 pasaba a $200 y seguía marcada como
  // PAGADA, descuadrando el corte de caja.
  it('cambiar el tope en Ajustes NO altera el precio de una nota ya cobrada', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 150 });
    const clienteId = await seedCliente();
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', cliente_id: clienteId,
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana', tamano: 'grande' }],
    });
    expect(creada.status).toBe(201);
    expect(Number(creada.body.precio_total)).toBe(150); // el tope ES el precio

    // El negocio sube el precio de la carga grande.
    await seedAjustes({ tope_carga_grande: 200 });

    // Una acción normal de Salidas sobre la nota vieja dispara el recálculo.
    const secadoraId = await seedMaquina({ nombre: 'S-tope', tipo: 'secadora' });
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: false }).expect(200);

    const despues = await request(app).get(`/api/notas/${creada.body.id}`).set(auth(admin.token));
    expect(Number(despues.body.precio_total)).toBe(150); // conserva lo cobrado
    // Y una nota NUEVA sí toma el precio nuevo.
    const nueva = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', cliente_id: clienteId,
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', tamano: 'grande' }],
    });
    expect(Number(nueva.body.precio_total)).toBe(200);
  });

  it('el tope no aplica a Autoservicio (solo tipo, sin tamaño)', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 50 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(201); // 70 > 50 pero autoservicio no tiene tope
    expect(Number(res.body.precio_total)).toBe(70);
  });
});

describe('handlers de máquina — ciclo de vida', () => {
  async function autoservicioLavando() {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const secadoraId = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    // Nuevo flujo: crea con TIPO, asigna la lavadora física y la arranca → LAVANDO.
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const cargaId = crea.body.cargas[0].id;
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });
    return { notaId: crea.body.id, lavadoraId, secadoraId };
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

  it('terminar-lavado-final (Autoservicio) finaliza la carga sin secado y deja la nota Lista', async () => {
    const { notaId, lavadoraId } = await autoservicioLavando();

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lavadoraId });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA'); // era la única máquina en uso

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('disponible');
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
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    const notaId = creada.body.id;
    // Asignar la lavadora y arrancarla → LAVANDO.
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId }).expect(200);

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
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
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
    expect(res.body.message).toMatch(/no puede pasar a/i);
  });
});

describe('handlers de máquina — asignar / cambiar / quitar', () => {
  // Nota Por Encargo En Espera: se crea con TIPO y luego se asigna la lavadora
  // física en Salidas, que queda disponible (sin iniciar) — el estado que
  // exigen cambiar y quitar máquina.
  async function porEncargoEnEspera() {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    await request(app).patch(`/api/notas/${res.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: res.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
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
    expect(res.body.message).toMatch(/se cobra/i);
  });

  it('asignar-secadora agrega el secado a la carga y ocupa la secadora', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const secadoraId = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });
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
});

describe('PATCH /api/notas/:id — edición', () => {
  async function autoservicio({ estado_pago = 'PENDIENTE', productos } = {}) {
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago,
      instrucciones: 'Original', cargas: [{ lavadora_tipo: 'mediana' }],
      ...(productos ? { productos } : {}),
    });
    return { notaId: res.body.id };
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
    // Autoservicio vende por BOTELLA (precio_botella); el stock se reserva en
    // tapas (4 por botella con los tamaños por defecto).
    const viejo = await seedProducto({ nombre: 'Viejo', precio_botella: 20, stock_actual: 50 });
    const nuevo = await seedProducto({ nombre: 'Nuevo', precio_botella: 35, stock_actual: 50 });
    const { notaId } = await autoservicio({ productos: [{ producto_id: viejo, cantidad: 2 }] });

    // Al crear se reservaron 2 botellas del viejo = 8 tapas.
    let r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [viejo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(8);

    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ productos: [{ producto_id: nuevo, cantidad: 1 }] });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(105); // 70 carga + 1 botella × 35

    r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [viejo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(0);  // liberado
    r = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [nuevo]);
    expect(Number(r.rows[0].stock_reservado)).toBe(4);  // 1 botella × 4 tapas
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
    const productoId = await seedProducto({ precio_unitario: 40 });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana' }],
    });
    // Editar la carga metiéndole un producto que la pasa del tope (70 + 40 > 100).
    const res = await request(app).patch(`/api/notas/${creada.body.id}`).set(auth(admin.token))
      .send({ cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                         productos: [{ producto_id: productoId, cantidad: 1 }] }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rebasa el tope/i);
  });
});

describe('permisos por rol', () => {
  it('un empleado no puede eliminar una nota (403); un admin sí (204)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const notaId = creada.body.id;

    await request(app).delete(`/api/notas/${notaId}`).set(auth(empleado.token)).expect(403);
    await request(app).delete(`/api/notas/${notaId}`).set(auth(admin.token)).expect(204);
  });
});

describe('cargas múltiples', () => {
  it('crea una nota con dos cargas por tipo y luego toma ambas lavadoras', async () => {
    const lav1 = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const lav2 = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [
        { lavadora_tipo: 'mediana' },
        { lavadora_tipo: 'mediana' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.cargas).toHaveLength(2);
    expect(res.body.estado).toBe('EN_ESPERA'); // nace sin máquina
    expect(Number(res.body.precio_total)).toBe(140); // 70 + 70

    // Se asignan las dos lavadoras físicas (Salidas) y se arrancan.
    await request(app).patch(`/api/notas/${res.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: res.body.cargas[0].id, slot: 'lavadora', maquina_id: lav1 });
    await request(app).patch(`/api/notas/${res.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: res.body.cargas[1].id, slot: 'lavadora', maquina_id: lav2 });
    await request(app).patch(`/api/notas/${res.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav1 });
    await request(app).patch(`/api/notas/${res.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav2 });
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = ANY($1)', [[lav1, lav2]]);
    expect(rows.every(m => m.estado === 'en_uso')).toBe(true);
  });

  it('activar-pendientes con maquina_id arranca solo esa máquina', async () => {
    const clienteId = await seedCliente();
    const lav1 = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const lav2 = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [
        { tamano: 'chico', lavadora_tipo: 'mediana' },
        { tamano: 'chico', lavadora_tipo: 'mediana' },
      ],
    });
    expect(creada.body.estado).toBe('EN_ESPERA');
    // Asignar las dos lavadoras físicas en Salidas (quedan En Espera).
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lav1 });
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: creada.body.cargas[1].id, slot: 'lavadora', maquina_id: lav2 });

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
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'jumbo' }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(80); // edredonJumbo (default)
    expect(Number(res.body.cargas[0].precio_lavadora)).toBe(80);
  });

  it('rechaza edredón con tipo de lavado que no es jumbo', async () => {
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/jumbo/i);
  });

  it('aplica el tope de edredón (lavado 80 + producto 90 > 160)', async () => {
    await seedAjustes({ precio_edredon_jumbo: 80, tope_carga_edredon: 160 });
    const clienteId = await seedCliente();
    const productoId = await seedProducto({ precio_unitario: 90 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE',
      // La prenda va en la carga (como la manda el frontend): así validarTopesCargas
      // la reconoce como edredón y aplica el tope dedicado.
      cargas: [{ lavadora_tipo: 'jumbo', tipo_prenda: 'EDREDON',
                 productos: [{ producto_id: productoId, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rebasa el tope/i);
  });
});

describe('productos por tapa', () => {
  it('en Por Encargo el producto por tapa se cobra (cuenta al total) y reserva stock', async () => {
    const clienteId = await seedCliente();
    const tapa = await seedProducto({ nombre: 'Suavizante', precio_unitario: 15, es_por_tapa: true });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: tapa, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    // Sin tope (la carga no tiene tamaño): suma real. La tapa ya no va gratis:
    // 70 lavado + 2×15 tapa = 100.
    expect(Number(res.body.precio_total)).toBe(100);
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [tapa]);
    expect(Number(rows[0].stock_reservado)).toBe(2);
  });

  it('en Autoservicio el producto se vende por botella (precio_botella)', async () => {
    const prod = await seedProducto({ nombre: 'Suavizante', precio_botella: 15 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: prod, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(100); // 70 lavado + 2 botellas × 15
    // Se reservan 2 botellas = 8 tapas.
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(rows[0].stock_reservado)).toBe(8);
  });

  it('al finalizar se consume el stock del producto (en tapas) y se registra la venta', async () => {
    const clienteId = await seedCliente();
    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const prod = await seedProducto({ nombre: 'Suavizante', precio_unitario: 15, stock_actual: 40 }); // 40 tapas
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 3 }] }],
    });
    const notaId = creada.body.id;
    // Por Encargo → tapa: 3 tapas reservadas, stock intacto.
    let r = await pool.query('SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(r.rows[0].stock_actual)).toBe(40);
    expect(Number(r.rows[0].stock_reservado)).toBe(3);

    // Asignar + arrancar → LAVANDO → LISTA → pagar → FINALIZAR.
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token)).send({ estado: 'LISTA' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`).set(auth(admin.token)).send({ estado: 'FINALIZADA' }).expect(200);

    // El stock se consumió (40 - 3 = 37) y se soltó la reserva.
    r = await pool.query('SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(r.rows[0].stock_actual)).toBe(37);
    expect(Number(r.rows[0].stock_reservado)).toBe(0);

    // Quedó registrada la venta en el historial.
    const movs = await request(app).get(`/api/productos/${prod}/movimientos`).set(auth(admin.token));
    expect(movs.body.some(m => m.tipo === 'venta' && Number(m.cantidad_tapas) === 3 && m.nota_id === notaId)).toBe(true);
  });
});

describe('cancelar nota', () => {
  it('cancelar devuelve el stock reservado y libera las máquinas', async () => {
    const clienteId = await seedCliente();
    const productoId = await seedProducto({ precio_unitario: 30, stock_actual: 10 });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
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
  });
});

describe('aislamiento por sucursal', () => {
  it('una máquina de otra sucursal no es asignable (400)', async () => {
    await seedSucursal('norte', 'Norte');
    const ajena = await seedMaquina({ nombre: 'Ajena', sucursal: 'norte' });

    const creada = await request(app).post('/api/notas').set(auth(admin.token, 'centro')).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(creada.status).toBe(201);

    // La máquina física se asigna en Salidas: una de otra sucursal no existe
    // desde esta sucursal, así que se rechaza (404, no asignable).
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token, 'centro'))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: ajena });
    expect(res.status).toBe(404);
  });
});

describe('bolsas en Por Encargo', () => {
  it('la bolsa (por pieza) se reserva y cuenta dentro del tope de la carga', async () => {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_chico: 100 });
    const clienteId = await seedCliente();
    // Bolsa chica: se crea y se le carga existencia con una entrada por rollo.
    const bolsa = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'chica', bolsas_por_rollo: 100, precio_unitario: 5,
    });
    await request(app).post(`/api/productos/${bolsa.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 1 }).expect(200); // 100 piezas

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana', productos: [{ producto_id: bolsa.body.id, cantidad: 1 }] }],
    });
    expect(res.status).toBe(201);
    // Costo real 70 lavado + 5 bolsa = 75 ≤ tope 100 → se cobra el tope (100),
    // la bolsa cuenta DENTRO del tope (no suma encima).
    expect(Number(res.body.precio_total)).toBe(100);

    // Se reservó 1 pieza y la línea va por pieza a su precio.
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [bolsa.body.id]);
    expect(Number(rows[0].stock_reservado)).toBe(1);
    const linea = res.body.cargas[0].productos.find(p => p.producto_id === bolsa.body.id);
    expect(linea.unidad).toBe('pieza');
    expect(Number(linea.precio_unitario)).toBe(5);
  });
});

describe('escenario real de creación (repro del error)', () => {
  it('Por Encargo con jabón (tapa) y bolsa dentro del tope', async () => {
    await seedAjustes({ precio_carga_mediana: 50, precio_carga_secadora: 45, tope_carga_chico: 150 });
    const clienteId = await seedCliente();
    const jabon = await seedProducto({ nombre: 'Jabón', precio_unitario: 5, stock_actual: 100 });
    const bolsa = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'chica', bolsas_por_rollo: 100, precio_unitario: 5,
    });
    await request(app).post(`/api/productos/${bolsa.body.id}/movimiento`).set(auth(admin.token))
      .send({ tipo: 'entrada', destino: 'piezas', unidad: 'rollo', cantidad: 1 }).expect(200);

    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{
        tamano: 'chico', lavadora_tipo: 'mediana', secadora_tipo: 'mediana',
        productos: [{ producto_id: jabon, cantidad: 1 }, { producto_id: bolsa.body.id, cantidad: 1 }],
      }],
    });
    expect(res.status).toBe(201);
    // real = 50 + 45 + 5(jabón) + 5(bolsa) = 105 ≤ 150 → tope 150
    expect(Number(res.body.precio_total)).toBe(150);
  });
});

describe('producto de carga sin existencia → 400 claro (no 500)', () => {
  it('crear Por Encargo con una bolsa sin stock devuelve 400 con mensaje', async () => {
    await seedAjustes({ precio_carga_mediana: 50 });
    const clienteId = await seedCliente();
    const bolsa = await request(app).post('/api/productos').set(auth(admin.token)).send({
      clase: 'bolsa', nombre: 'Bolsa', tamano_bolsa: 'chica', bolsas_por_rollo: 100, precio_unitario: 5,
    }); // stock 0
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana', productos: [{ producto_id: bolsa.body.id, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/suficiente existencia/i);
    expect(res.body.message).toMatch(/Bolsa chica/i);
  });
});

describe('motivo de cancelación', () => {
  it('guarda el motivo al cancelar la nota', async () => {
    const clienteId = await seedCliente();
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA', motivo: 'El cliente ya no lo quiere' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    expect(res.body.motivo_cancelacion).toBe('El cliente ya no lo quiere');
  });
});

// Regresión: una nota con varias cargas pasaba a "Por entregar" —y dejaba
// liquidar— en cuanto terminaba la PRIMERA, porque se miraba solo si quedaban
// máquinas en uso y una carga sin arrancar no tiene ninguna.
describe('nota con varias cargas: no está lista hasta terminarlas todas', () => {
  async function notaDeDosCargas() {
    const lav1 = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const lav2 = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }, { lavadora_tipo: 'mediana' }],
    });
    return { notaId: crea.body.id, cargas: crea.body.cargas, lav1, lav2 };
  }

  const asignarYArrancar = async (notaId, cargaId, maquinaId) => {
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: maquinaId }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: maquinaId }).expect(200);
  };

  it('terminar la primera carga NO deja la nota lista si la otra no ha arrancado', async () => {
    const { notaId, cargas, lav1 } = await notaDeDosCargas();
    await asignarYArrancar(notaId, cargas[0].id, lav1);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav1 });
    expect(res.status).toBe(200);
    expect(res.body.estado).not.toBe('LISTA');
  });

  it('al terminar TODAS las cargas la nota queda lista', async () => {
    const { notaId, cargas, lav1, lav2 } = await notaDeDosCargas();

    await asignarYArrancar(notaId, cargas[0].id, lav1);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav1 }).expect(200);

    await asignarYArrancar(notaId, cargas[1].id, lav2);
    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav2 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
  });

  it('una carga apenas asignada (sin arrancar) también retiene la nota', async () => {
    const { notaId, cargas, lav1, lav2 } = await notaDeDosCargas();
    await asignarYArrancar(notaId, cargas[0].id, lav1);
    // La segunda queda asignada pero nadie le dio "Iniciar".
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargas[1].id, slot: 'lavadora', maquina_id: lav2 }).expect(200);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav1 });
    expect(res.body.estado).not.toBe('LISTA');
  });
});

// En autoservicio el cliente está en el local y se lleva su ropa él mismo: no
// hay nada "por entregar", así que la nota se cierra sola al terminar sus
// cargas. Por Encargo y Edredón sí esperan en Por Entregar a que la recojan.
describe('cierre automático de la nota al terminar sus cargas', () => {
  const arrancar = async (notaId, cargaId, maquinaId) => {
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: maquinaId }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: maquinaId }).expect(200);
  };

  const terminarUnicaCarga = async (body) => {
    const lav = await seedMaquina({ nombre: `Lavadora ${Date.now()}`, tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ tipo_prenda: 'ROPA', cargas: [{ lavadora_tipo: 'mediana' }], ...body });
    expect(crea.status).toBe(201);
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    return request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav });
  };

  it('autoservicio pagado: queda FINALIZADA, sin pasar por Por Entregar', async () => {
    const res = await terminarUnicaCarga({
      tipo_servicio: 'AUTOSERVICIO', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('FINALIZADA');
  });

  it('autoservicio que quedó a deber: se queda en Por Entregar para poder cobrarlo', async () => {
    const res = await terminarUnicaCarga({
      tipo_servicio: 'AUTOSERVICIO', estado_pago: 'PENDIENTE',
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
  });

  it('por encargo pagado: sigue esperando en Por Entregar a que lo recojan', async () => {
    const clienteId = await seedCliente();
    const res = await terminarUnicaCarga({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId,
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
  });
});

describe('cancelar una nota es cosa de administradores', () => {
  it('un empleado no puede cancelar', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });

    const res = await request(app).patch(`/api/notas/${nota.body.id}/estado`)
      .set(auth(empleado.token)).send({ estado: 'CANCELADA', motivo: 'me equivoqué' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/administrador/i);

    const { rows } = await pool.query('SELECT estado FROM notas WHERE id = $1', [nota.body.id]);
    expect(rows[0].estado).not.toBe('CANCELADA');
  });

  it('ni el admin puede cancelar una nota ya cobrada: primero se revierte el pago', async () => {
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });

    const res = await request(app).patch(`/api/notas/${nota.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA', motivo: 'ya no la quiso' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/revierte el pago/i);

    // Revertir el pago sí abre la puerta a cancelarla.
    await request(app).patch(`/api/notas/${nota.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE' }).expect(200);
    const segunda = await request(app).patch(`/api/notas/${nota.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA', motivo: 'ya no la quiso' });
    expect(segunda.status).toBe(200);
    expect(segunda.body.estado).toBe('CANCELADA');
  });

  it('un admin sí puede', async () => {
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const res = await request(app).patch(`/api/notas/${nota.body.id}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA', motivo: 'el cliente se arrepintió' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
  });
});

// La contraparte de "no está lista hasta terminarlas todas": si una carga ya no
// se va a usar, tiene que haber forma de cerrar la nota. Sin esto se quedaba En
// Espera para siempre, sin botón de liquidar y sin cierre automático.
describe('una nota no se queda atascada si sobra una carga', () => {
  async function notaConCargaTerminadaYOtraSinUsar() {
    const lav = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }, { lavadora_tipo: 'mediana' }],
    });
    const notaId = crea.body.id;
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`).set(auth(admin.token))
      .send({ lavadora_id: lav }).expect(200);
    return { notaId, cargaUsada: crea.body.cargas[0].id, cargaSinUsar: crea.body.cargas[1].id };
  }

  it('quitar la carga que sobra deja la nota lista y deja de cobrarla', async () => {
    const { notaId, cargaSinUsar } = await notaConCargaTerminadaYOtraSinUsar();
    const antes = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    expect(antes.body.estado).not.toBe('LISTA');
    expect(Number(antes.body.precio_total)).toBe(140); // dos cargas

    const res = await request(app).delete(`/api/notas/${notaId}/cargas/${cargaSinUsar}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
    expect(Number(res.body.precio_total)).toBe(70); // ya no se cobra la carga no usada
    expect(res.body.cargas).toHaveLength(1);
  });

  it('no deja quitar una carga que ya se lavó: es historial', async () => {
    const { notaId, cargaUsada } = await notaConCargaTerminadaYOtraSinUsar();
    const res = await request(app).delete(`/api/notas/${notaId}/cargas/${cargaUsada}`)
      .set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya se procesó/i);
  });

  it('no deja a la nota sin ninguna carga', async () => {
    const lav = await seedMaquina({ nombre: 'Única', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const res = await request(app).delete(`/api/notas/${crea.body.id}/cargas/${crea.body.cargas[0].id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/sin cargas/i);
    expect(lav).toBeTruthy();
  });

  it('también se puede cerrar a mano desde En Espera', async () => {
    const { notaId } = await notaConCargaTerminadaYOtraSinUsar();
    const res = await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'LISTA' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
  });
});

// Editar una nota borraba TODAS sus cargas y las recreaba: la carga ya lavada
// perdía qué máquina la lavó y cuándo, y con eso el reporte de uso de máquinas.
describe('editar una nota en proceso no borra lo que ya se lavó', () => {
  async function notaConUnaCargaLavada() {
    const lav = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }, { lavadora_tipo: 'mediana' }],
    });
    const notaId = crea.body.id;
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`).set(auth(admin.token))
      .send({ lavadora_id: lav }).expect(200);
    return { notaId, lav, lavada: crea.body.cargas[0].id, pendiente: crea.body.cargas[1].id };
  }

  it('conserva la máquina usada y la hora de arranque de la carga ya lavada', async () => {
    const { notaId, lav, lavada, pendiente } = await notaConUnaCargaLavada();

    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token)).send({
      cargas: [
        { id: lavada, lavadora_tipo: 'mediana' },
        { id: pendiente, lavadora_tipo: 'mediana' },
      ],
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT id, lavadora_usada_id, lavadora_iniciada_at FROM nota_cargas WHERE id = $1', [lavada]
    );
    // La fila sobrevive con su historial intacto.
    expect(rows).toHaveLength(1);
    expect(rows[0].lavadora_usada_id).toBe(lav);
    expect(rows[0].lavadora_iniciada_at).not.toBeNull();
  });

  it('rechaza quitar al editar una carga que ya se lavó', async () => {
    const { notaId, pendiente } = await notaConUnaCargaLavada();

    // Se manda solo la carga pendiente: la lavada desaparecería.
    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token))
      .send({ cargas: [{ id: pendiente, lavadora_tipo: 'mediana' }] });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ya se procesó/i);
  });

  it('sí deja cambiar y agregar cargas que no han arrancado', async () => {
    const { notaId, lavada, pendiente } = await notaConUnaCargaLavada();

    const res = await request(app).patch(`/api/notas/${notaId}`).set(auth(admin.token)).send({
      cargas: [
        { id: lavada, lavadora_tipo: 'mediana' },
        { id: pendiente, lavadora_tipo: 'mediana', secadora_tipo: 'mediana' },
        { lavadora_tipo: 'mediana' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(3);
    // La lavada sigue siendo la primera y conserva su lugar.
    expect(res.body.cargas[0].id).toBe(lavada);
  });
});
