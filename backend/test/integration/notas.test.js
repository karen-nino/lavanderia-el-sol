import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { liberarMaquinasCierreDelDia } from '../../jobs/cierreDelDia.js';
import {
  pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina,
  seedCliente, seedProducto, seedAjustes, seedEtiquetas, auth,
} from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  // El catálogo de tamaños de bolsa lo siembra la mig. 119, pero limpiarBase
  // lo vacía: sin él no se puede dar de alta una bolsa.
  await seedEtiquetas('tamanos_bolsa', ['Chica', 'Grande', 'Jumbo']);
  // Los precios de los servicios Por Encargo (Chica 120, Grande 150, Edredón
  // 180) van de entrada, como en la aplicación: sin ellos no se puede crear la
  // nota. Cada prueba que necesite otros los sobreescribe con seedAjustes.
  await seedAjustes();
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
  it('crea la nota con tipo de lavado, sin máquina y todavía sin cobrar nada', async () => {
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
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
    // Autoservicio NO se tarifa al crear (2026-09-25): la máquina se cobra
    // cuando se asigna la física en Salidas.
    expect(Number(res.body.precio_total)).toBe(0);

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
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
      tiempo_entrega: 'DOS_DIAS',
      cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.tipo_servicio).toBe('POR_ENCARGO');
    expect(res.body.estado).toBe('EN_ESPERA');
    expect(res.body.estado_pago).toBe('PENDIENTE');
    expect(res.body.cliente_id).toBe(clienteId);
    // No se reserva máquina: la carga guarda el tipo previsto, sin lavadora_id.
    // El precio es el del SERVICIO Chica (120), no la tarifa de la máquina: lo
    // que se cobra en Por Encargo ya no depende de en qué se lave.
    expect(res.body.cargas).toHaveLength(1);
    expect(res.body.cargas[0].lavadora_id).toBeNull();
    expect(res.body.cargas[0].lavadora_tipo).toBe('mediana');
    expect(Number(res.body.precio_total)).toBe(120);

    const detalle = await request(app).get(`/api/notas/${res.body.id}`).set(auth(admin.token));
    expect(detalle.body.cliente_nombre).toBe('Ana');
    // El detalle expone el tipo previsto para asignar la máquina en Salidas.
    expect(detalle.body.cargas[0].lavadora_tipo_previsto).toBe('mediana');
    expect(detalle.body.cargas[0].lavadora_id).toBeNull();
  });

  it('asignar-carga-maquina pone la máquina en la carga (y rechaza una secadora)', async () => {
    const clienteId = await seedCliente();
    const lavMed = await seedMaquina({ nombre: 'Lav Mediana', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const sec = await seedMaquina({ nombre: 'Sec 1', tipo: 'secadora', tamano: 'mediana' });

    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    const cargaId = nota.body.cargas[0].id;

    // Una secadora nunca entra en el hueco de lavadora.
    const malo = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token)).send({ carga_id: cargaId, slot: 'lavadora', maquina_id: sec });
    expect(malo.status).toBe(400);

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

  // El tamaño dejó de atar la asignación (2026-09-26): en el mostrador la ropa
  // entra en la lavadora que esté libre, y el precio de Por Encargo no depende
  // de cuál sea —se cobra el tope de la carga, congelado al crear la nota—.
  it('asignar-carga-maquina acepta una jumbo en una carga mediana, sin mover el precio', async () => {
    const clienteId = await seedCliente();
    const lavJum = await seedMaquina({ nombre: 'Lav Jumbo', tipo: 'lavadora_jumbo', tamano: 'jumbo' });

    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', lavadora_tipo: 'mediana' }],
    });
    const antes = Number(nota.body.precio_total);

    const ok = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: nota.body.cargas[0].id, slot: 'lavadora', maquina_id: lavJum });
    expect(ok.status).toBe(200);
    expect(ok.body.cargas[0].lavadora_id).toBe(lavJum);
    expect(Number(ok.body.precio_total)).toBe(antes);
  });

  // La excepción que sigue en pie, y que antes tapaba el chequeo de tamaño:
  // un edredón no cabe en una mediana.
  it('asignar-carga-maquina rechaza una mediana para un edredón', async () => {
    const clienteId = await seedCliente();
    const lavMed = await seedMaquina({ nombre: 'Lav Mediana', tipo: 'lavadora_mediana', tamano: 'mediana' });

    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'jumbo', tipo_prenda: 'EDREDON', lavadora_tipo: 'jumbo' }],
    });
    expect(nota.status).toBe(201);

    const malo = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: nota.body.cargas[0].id, slot: 'lavadora', maquina_id: lavMed });
    expect(malo.status).toBe(400);
    expect(malo.body.message).toMatch(/edredones solo van en lavadora jumbo/i);
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
// La tarjeta de Máquinas usa este campo para decidir el botón de una lavadora
// que terminó: con la lavadora marcada ofrece "Iniciar secado" (y pide elegir
// secadora ahí mismo); sin marcar, "Finalizar carga".
// Lo cobrado en un corte CERRADO no se deshace por la puerta de atrás: cambiar
// lo que cuesta la nota la devolvería a pendiente, y ese corte ya cuenta la
// venta (mig. 101).
describe('un cobro congelado en su corte no se deshace por un cambio', () => {
  async function notaPagadaEnCorteCerrado() {
    // Autoservicio cobra la BOTELLA, así que sin `precio_botella` el producto
    // valdría 0 y quitarlo no movería el total (que es lo que se prueba).
    const productoId = await seedProducto({ nombre: 'Jabón', stock_actual: 50, precio_botella: 30 });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: productoId, cantidad: 1 }],
    });
    expect(nota.status).toBe(201);
    // Su cobro queda atado a una caja ya cerrada.
    const { rows: caja } = await pool.query(
      `INSERT INTO cajas (usuario_apertura_id, estado, monto_inicial, abierta_at, cerrada_at, sucursal)
       VALUES ($1, 'cerrada', 0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '12 hours', 'centro')
       RETURNING id`, [admin.id]
    );
    await pool.query('UPDATE notas SET caja_id = $1 WHERE id = $2', [caja[0].id, nota.body.id]);
    return { notaId: nota.body.id, productoId };
  }

  it('quitar un producto se rechaza con 409 y el pago no se mueve', async () => {
    const { notaId, productoId } = await notaPagadaEnCorteCerrado();
    const res = await request(app).delete(`/api/notas/${notaId}/productos/${productoId}`)
      .set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/corte cerrado/i);

    const { rows } = await pool.query('SELECT estado_pago, caja_id FROM notas WHERE id = $1', [notaId]);
    expect(rows[0].estado_pago).toBe('PAGADO');
    expect(rows[0].caja_id).not.toBeNull();
  });

  // Borrar la nota entera era la única puerta que seguía abierta: el corte de
  // aquel día conserva la venta y Ventas, que suma notas vivas, la perdía.
  it('borrar la nota entera también se rechaza con 409', async () => {
    const { notaId } = await notaPagadaEnCorteCerrado();
    const res = await request(app).delete(`/api/notas/${notaId}`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/corte cerrado/i);

    const { rows } = await pool.query('SELECT estado_pago FROM notas WHERE id = $1', [notaId]);
    expect(rows).toHaveLength(1);              // la nota sigue ahí
    expect(rows[0].estado_pago).toBe('PAGADO');
  });

  it('con la caja de ese cobro abierta, la nota sí se borra', async () => {
    const { notaId } = await notaPagadaEnCorteCerrado();
    await pool.query("UPDATE cajas SET estado = 'abierta', cerrada_at = NULL WHERE id = (SELECT caja_id FROM notas WHERE id = $1)", [notaId]);
    await request(app).delete(`/api/notas/${notaId}`).set(auth(admin.token)).expect(204);
    const { rows } = await pool.query('SELECT id FROM notas WHERE id = $1', [notaId]);
    expect(rows).toHaveLength(0);
  });

  it('con la caja de ese cobro ABIERTA sí se puede', async () => {
    const { notaId, productoId } = await notaPagadaEnCorteCerrado();
    await pool.query("UPDATE cajas SET estado = 'abierta', cerrada_at = NULL WHERE id = (SELECT caja_id FROM notas WHERE id = $1)", [notaId]);
    const res = await request(app).delete(`/api/notas/${notaId}/productos/${productoId}`)
      .set(auth(admin.token));
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT estado_pago FROM notas WHERE id = $1', [notaId]);
    expect(rows[0].estado_pago).toBe('PENDIENTE');
  });
});

// La pantalla usa este campo para NO prometer "Por Entregar" al cerrar una
// máquina. Tiene que ver todo lo que sobrevive a ese cierre, no solo lo que
// falta asignar: una máquina puesta y sin arrancar, o detenida a media vuelta,
// deja la nota en proceso igual.
describe('trabajo pendiente de una nota', () => {
  async function conCarga(extra = {}) {
    const lavadoraId = await seedMaquina({ nombre: `L-${Math.random().toString(36).slice(2, 7)}`, tipo: 'lavadora_mediana' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: await seedCliente(), tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana', ...extra }],
    });
    return { notaId: nota.body.id, cargaId: nota.body.cargas[0].id, lavadoraId };
  }
  const pendiente = async (notaId) => {
    const lista = await request(app).get('/api/notas').set(auth(admin.token));
    return lista.body.find(n => n.id === notaId).trabajo_pendiente;
  };

  it('una máquina que la carga compró y no tiene puesta cuenta como pendiente', async () => {
    const { notaId } = await conCarga({ secadora_tipo: 'mediana' });
    expect(await pendiente(notaId)).toBe(true);
  });

  it('una máquina puesta y sin arrancar también', async () => {
    const { notaId, cargaId, lavadoraId } = await conCarga();
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
    expect(await pendiente(notaId)).toBe(true);
  });

  it('la máquina que está CORRIENDO no cuenta: es la que se va a cerrar', async () => {
    const { notaId, cargaId, lavadoraId } = await conCarga();
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId }).expect(200);
    expect(await pendiente(notaId)).toBe(false);
  });

  it('un ciclo DETENIDO vuelve a dejar trabajo, aunque la máquina ya había arrancado', async () => {
    const { notaId, cargaId, lavadoraId } = await conCarga();
    await request(app).patch(`/api/notas/${notaId}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });
    await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`).set(auth(admin.token)).expect(200);
    expect(await pendiente(notaId)).toBe(true);
  });
});

describe('encadenar el secado es cosa de Autoservicio', () => {
  async function conLavadoraPuesta(tipo_servicio) {
    const lavadoraId = await seedMaquina({ nombre: `L-${tipo_servicio}`, tipo: 'lavadora_mediana' });
    const extra = tipo_servicio === 'POR_ENCARGO' ? { cliente_id: await seedCliente() } : {};
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', ...extra,
      cargas: [{ lavadora_tipo: 'mediana', secadora_tipo: 'mediana' }],
    });
    expect(nota.status).toBe(201);
    await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: nota.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId })
      .expect(200);
    const lista = await request(app).get('/api/notas').set(auth(admin.token));
    const fila = lista.body.find(n => n.id === nota.body.id);
    return { lavadoraId, marcadas: fila.lavadoras_con_secado_ids };
  }

  it('en Autoservicio la lavadora con secado pendiente queda marcada', async () => {
    const { lavadoraId, marcadas } = await conLavadoraPuesta('AUTOSERVICIO');
    expect(marcadas.map(Number)).toContain(lavadoraId);
  });

  // La ropa se queda en el local: la lavadora cierra su carga y la secadora se
  // asigna y arranca aparte, desde Salidas.
  it('en Por Encargo no se marca ninguna, aunque la carga lleve secado', async () => {
    const { marcadas } = await conLavadoraPuesta('POR_ENCARGO');
    expect(marcadas).toEqual([]);
  });
});

describe('quién se queda con la máquina: la primera que inicia', () => {
  // Pagada por omisión: en autoservicio no se arranca una carga sin cobrar.
  // Las que solo apartan la máquina para cancelarse después van sin pagar,
  // porque una nota ya cobrada no se cancela sin revertir el pago primero.
  const crearConTipo = ({ pagada = true } = {}) =>
    request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      ...(pagada ? { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' } : { estado_pago: 'PENDIENTE' }),
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
    const b = (await crearConTipo({ pagada: false })).body;   // se va a cancelar
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
    const creada = await crearNotaEncargo('PAGADO');
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
    const creada = await crearNotaEncargo('PAGADO');
    const total = Number(creada.body.precio_total);

    const secadoraId = await seedMaquina({ nombre: 'S-gratis', tipo: 'secadora' });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: false });

    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(total);
    expect(res.body.estado_pago).toBe('PAGADO');
  });

  it('una nota PENDIENTE sigue pendiente (no hay pago que deshacer)', async () => {
    const creada = await crearNotaEncargo('PENDIENTE');
    const secadoraId = await seedMaquina({ nombre: 'S-pend', tipo: 'secadora' });
    const res = await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: true });
    expect(res.status).toBe(200);
    expect(res.body.estado_pago).toBe('PENDIENTE');
  });

  it('deja aviso en la campana con los dos importes', async () => {
    const creada = await crearNotaEncargo('PAGADO');
    const secadoraId = await seedMaquina({ nombre: 'S-aviso', tipo: 'secadora' });
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [secadoraId], cobrar: true }).expect(200);

    const avisos = await request(app).get('/api/notificaciones').set(auth(admin.token));
    const aviso = (avisos.body ?? []).find(n => n.tipo === 'pago_desmarcado');
    expect(aviso).toBeTruthy();
    expect(aviso.mensaje).toMatch(/PENDIENTE de cobro/);
  });
});

// Nota Por Encargo de una carga con lavado mediana (tarifa 70). Va Por Encargo
// y no Autoservicio porque agregar una máquina a la nota SOLO existe ahí: en
// Autoservicio se cobra por adelantado, así que una máquina de más es una nota
// nueva, y el endpoint lo rechaza.
async function crearNotaEncargo(estado_pago) {
  await seedAjustes({ precio_carga_mediana: 70, precio_carga_secadora: 45 });
  const clienteId = await seedCliente();
  const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
    tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
    estado_pago, ...(estado_pago === 'PAGADO' ? { forma_pago: 'EFECTIVO' } : {}),
    cargas: [{ lavadora_tipo: 'mediana' }],
  });
  expect(creada.status).toBe(201);
  return creada;
}

// Por Encargo vende SERVICIOS: Chica, Grande y Edredón, cada uno a su precio de
// Ajustes. La nota ya no elige tipo de máquina —eso se decide en Salidas, sin
// tocar el cobro— y lo que el cliente compra aparte va a nivel nota, encima del
// precio de los servicios.
describe('servicios Por Encargo (sin tipo de máquina)', () => {
  it('cobra el precio de cada servicio y no exige tipo de máquina', async () => {
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [
        { tamano: 'chico',  tipo_prenda: 'ROPA' },
        { tamano: 'chico',  tipo_prenda: 'ROPA' },
        { tamano: 'jumbo',  tipo_prenda: 'EDREDON' },
      ],
    });
    expect(res.status).toBe(201);
    // 120 + 120 + 180, los precios que siembra seedAjustes.
    expect(Number(res.body.precio_total)).toBe(420);
    expect(res.body.cargas).toHaveLength(3);
    for (const c of res.body.cargas) {
      expect(c.lavadora_tipo).toBeNull();
      expect(c.secadora_tipo).toBeNull();
      expect(Number(c.precio_lavadora)).toBe(0);
    }
    // La nota nace En Espera: no hay máquina que arrancar.
    expect(res.body.estado).toBe('EN_ESPERA');
  });

  // El granel que el mostrador agrega a la nota es MATERIAL del servicio: no se
  // cobra aparte —el precio del servicio ya lo paga— pero gasta de su tope.
  it('el granel de la nota va dentro del servicio y gasta de su tope', async () => {
    const clienteId = await seedCliente();
    const jabon = await seedProducto({ nombre: 'Jabón', stock_actual: 100, precio_unitario: 7 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', tipo_prenda: 'ROPA' }],
      productos: [{ producto_id: jabon, cantidad: 3 }],
      ajuste: -20,
    });
    expect(res.status).toBe(201);
    // Servicio Grande 150 − 20 de ajuste: las 3 tapas van dentro.
    expect(Number(res.body.precio_total)).toBe(130);
  });

  // Y si con ellos el material se pasa del precio de los servicios, no se crea:
  // servir $210 de jabón en una nota de $150 sería regalarlo.
  it('el granel que rebasa el precio de los servicios → 400', async () => {
    const clienteId = await seedCliente();
    const jabon = await seedProducto({ nombre: 'Jabón caro', stock_actual: 100, precio_unitario: 70 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }], // servicio de 120
      productos: [{ producto_id: jabon, cantidad: 3 }],   // 210 de material
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/material de la nota/i);
  });

  // Y el de marca gasta del mismo bolsillo: dos jabones de marca en un servicio
  // Chica de $120 no caben, aunque sean de marca.
  it('el producto de marca también cuenta contra el precio de los servicios', async () => {
    const clienteId = await seedCliente();
    const marca = await seedProducto({
      nombre: 'Persil', tipo_liquido: 'marca', precio_unitario: 300, precio_botella: 300,
    });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
      productos: [{ producto_id: marca, cantidad: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/material de la nota/i);
  });

  // "Otro ciclo" del renglón de la máquina: se vuelve a poner la MISMA máquina
  // en el hueco que acaba de dejar libre. Entra como una pasada repetida —un
  // solo ciclo— y, si la nota ya había pasado a Por Entregar, vuelve a En
  // Espera: si no, no habría forma de encenderla ni de iniciarla.
  it('otro ciclo: repite la máquina, corre un solo ciclo y reabre la nota', async () => {
    const clienteId = await seedCliente();
    const lav = await seedMaquina({ nombre: 'L-otro', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
    });
    const notaId = nota.body.id;
    const total  = Number(nota.body.precio_total);

    // La máquina se agrega en Salidas, abre su renglón, se arranca y se termina.
    const conMaquina = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [lav], cobrar: false });
    expect(conMaquina.status).toBe(200);
    const cargaMaquina = conMaquina.body.cargas.find(c => String(c.lavadora_id) === String(lav));
    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`)
      .set(auth(admin.token)).send({ maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav }).expect(200);

    // Se marca "Procesado", que es lo único que la pasa a Por Entregar.
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'LISTA' }).expect(200);

    // Otro ciclo: la misma máquina, al mismo hueco.
    const otro = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [lav], cobrar: false, carga_id: cargaMaquina.id });
    expect(otro.status).toBe(200);
    // Vuelve a haber trabajo: la nota deja de estar Por Entregar.
    expect(otro.body.estado).toBe('EN_ESPERA');
    // Y el total no se mueve: en Por Encargo lo que se cobra es el servicio.
    expect(Number(otro.body.precio_total)).toBe(total);

    // La vuelta nueva es una repetición: un solo ciclo.
    const { rows } = await pool.query(
      `SELECT ciclo_unico FROM nota_carga_maquinas
        WHERE carga_id = $1 AND slot = 'lavadora' ORDER BY asignada_at, id`, [cargaMaquina.id]
    );
    expect(rows.map(x => x.ciclo_unico)).toEqual([false, true]);
  });

  // Por Encargo pasa a Por Entregar SOLO cuando alguien confirma "Procesado"
  // (2026-09-28): que las máquinas terminen no quiere decir que la ropa esté
  // doblada, empacada y revisada.
  describe('a Por Entregar solo por "Procesado"', () => {
    // Deja la nota con su lavado terminado y devuelve su id y su estado.
    async function trasLavar(nombre) {
      const clienteId = await seedCliente();
      const lav = await seedMaquina({ nombre: `L-${nombre}`, tipo: 'lavadora_mediana', tamano: 'mediana' });
      const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
        tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
        estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
      });
      expect(nota.status).toBe(201);
      const notaId = nota.body.id;
      await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
        .set(auth(admin.token)).send({ maquina_ids: [lav], cobrar: false }).expect(200);
      await request(app).patch(`/api/notas/${notaId}/activar-pendientes`)
        .set(auth(admin.token)).send({ maquina_id: lav }).expect(200);
      await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
        .set(auth(admin.token)).send({ lavadora_id: lav }).expect(200);
      const res = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
      return { notaId, estado: res.body.estado, lav };
    }

    it('terminar la última máquina NO la pasa a Por Entregar', async () => {
      const { estado } = await trasLavar('proc');
      expect(estado).toBe('EN_ESPERA');
    });

    it('confirmar "Procesado" sí, y de paso suelta sus máquinas', async () => {
      const { notaId, lav } = await trasLavar('proc2');
      const res = await request(app).patch(`/api/notas/${notaId}/estado`)
        .set(auth(admin.token)).send({ estado: 'LISTA' });
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe('LISTA');
      const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lav]);
      expect(rows[0].estado).toBe('disponible');
    });

    // El cierre del día está para soltar máquinas, no para dar por procesada la
    // ropa de nadie: una nota Por Encargo que se quedó lavando vuelve a En Espera.
    it('el cierre del día tampoco la da por procesada', async () => {
      const { notaId, lav } = await trasLavar('cierre');
      // Se la deja lavando otra vez, como una nota que nadie cerró en la noche.
      await pool.query("UPDATE notas SET estado = 'LAVANDO' WHERE id = $1", [notaId]);
      await pool.query("UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1", [lav]);
      await liberarMaquinasCierreDelDia();
      const res = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
      expect(res.body.estado).toBe('EN_ESPERA');
    });
  });

  // El tope tiene que cubrir la máquina, no solo el jabón: un servicio Chica va
  // en lavadora y secadora medianas, y ese costo sale del mismo precio.
  it('la máquina del servicio cuenta contra su tope', async () => {
    const clienteId = await seedCliente();
    // Chica: tope 120, máquina 70 + 45 = 115. Quedan 5 para material.
    const caro = await seedProducto({ nombre: 'Jabón caro', stock_actual: 100, precio_unitario: 10 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA',
                 productos: [{ producto_id: caro, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400); // 115 + 10 = 125 > 120
    expect(res.body.message).toMatch(/máquinas \$115\.00/);
  });

  // El edredón va en la lavadora jumbo y sin secado: su costo es otro.
  it('el edredón cuenta su lavadora jumbo y no una secadora', async () => {
    const clienteId = await seedCliente();
    // Edredón: tope 180, lavadora jumbo de edredón 80. Quedan 100.
    const prod = await seedProducto({ nombre: 'Jabón', stock_actual: 100, precio_unitario: 90 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'EDREDON',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'jumbo', tipo_prenda: 'EDREDON',
                 productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    expect(res.status).toBe(201); // 80 + 90 = 170 ≤ 180
    expect(Number(res.body.precio_total)).toBe(180);
  });

  it('sin precio configurado para ese servicio → 400 que dice cuál falta', async () => {
    await seedAjustes({ tope_carga_grande: null });
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'grande', tipo_prenda: 'ROPA' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/precio del servicio Grande/i);
  });

  // Las máquinas son INDEPENDIENTES de lo que se vendió: la nota captura los
  // servicios y en Salidas se agregan las máquinas que de verdad se usan, tantas
  // como haga falta. Un servicio sin máquina no es una máquina esperando turno,
  // así que lo que dice si a la nota le falta trabajo son sus máquinas.
  it('la máquina agregada abre su propio renglón, sin tocar el precio', async () => {
    const clienteId = await seedCliente();
    const sec = await seedMaquina({ nombre: 'S-serv', tipo: 'secadora', tamano: 'mediana' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }, { tamano: 'chico', tipo_prenda: 'ROPA' }],
    });
    expect(nota.status).toBe(201);
    expect(Number(nota.body.precio_total)).toBe(240); // dos servicios Chica

    // Sin carga destino: la máquina entra como un renglón más, sin cobro.
    const res = await request(app).patch(`/api/notas/${nota.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [sec], cobrar: false });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(3);
    // El renglón de la máquina no vende nada: sin precio de servicio y en $0.
    const extra = res.body.cargas.find(c => String(c.secadora_id) === String(sec));
    expect(extra.precio_tope ?? null).toBeNull();
    expect(Number(extra.precio_secadora)).toBe(0);
    // Y el total sigue siendo el de los servicios.
    expect(Number(res.body.precio_total)).toBe(240);
  });
});

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

  // El jabón de MARCA también es material del lavado: con él se lava la ropa,
  // así que el precio del servicio lo paga y cuenta contra el tope como el
  // granel (2026-09-28). Vender una botella es una nota de Productos.
  it('un producto de marca va dentro del servicio y cuenta contra el tope', async () => {
    const { clienteId } = await armar();
    const marca = await seedProducto({
      nombre: 'Ensueño', tipo_liquido: 'marca', precio_unitario: 40, precio_botella: 20,
    });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                 productos: [{ producto_id: marca, cantidad: 1 }] }],
    });
    // 70 (máquina) + 20 (producto) = 90, cabe en el tope de 100.
    expect(res.status).toBe(201);
    // Y se cobra el tope y nada más: el producto va dentro.
    expect(Number(res.body.precio_total)).toBe(100);
    // Se sirvió la unidad completa: 4 tapas (800 ml / 200 ml).
    const { rows } = await pool.query(
      `SELECT np.unidad, a.stock_reservado
         FROM nota_productos np JOIN productos a ON a.id = np.producto_id
        WHERE np.producto_id = $1`, [marca]);
    expect(rows[0].unidad).toBe('botella');
    expect(Number(rows[0].stock_reservado)).toBe(4);
  });

  it('un producto de marca que rebasa el tope → 400', async () => {
    const { clienteId } = await armar();
    const marca = await seedProducto({
      nombre: 'Persil', tipo_liquido: 'marca', precio_unitario: 40, precio_botella: 120,
    });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                 productos: [{ producto_id: marca, cantidad: 1 }] }],
    });
    expect(res.status).toBe(400); // 70 + 120 = 190 > 100
    expect(res.body.message).toMatch(/se cobra en/i);
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
    expect(res.body.message).toMatch(/se cobra en/i);
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(201); // 70 > 50 pero autoservicio no tiene tope
    // Y todavía en $0: se tarifa al asignar la máquina en Salidas.
    expect(Number(res.body.precio_total)).toBe(0);
  });
});

describe('handlers de máquina — ciclo de vida', () => {
  async function autoservicioLavando() {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    const secadoraId = await seedMaquina({ nombre: 'Secadora 1', tipo: 'secadora', tamano: 'mediana' });
    // Nuevo flujo: crea con TIPO (la nota nace en $0), asigna la lavadora
    // física —que es cuando se tarifa (2026-09-25)—, la arranca y hasta
    // entonces se cobra: antes de asignar el servidor no deja cobrarla.
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const cargaId = crea.body.cargas[0].id;
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: cargaId, slot: 'lavadora', maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lavadoraId });
    await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
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

  it('terminar-lavado-final (Autoservicio) finaliza la carga sin secado y cierra la nota', async () => {
    const { notaId, lavadoraId } = await autoservicioLavando();

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lavadoraId });
    expect(res.status).toBe(200);
    // Era la única máquina en uso, y en autoservicio no hay nada por entregar.
    expect(res.body.estado).toBe('FINALIZADA');

    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(rows[0].estado).toBe('disponible');
  });

  it('terminar-secado cierra la nota de autoservicio y libera la secadora', async () => {
    const { notaId, lavadoraId, secadoraId } = await autoservicioLavando();
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado`)
      .set(auth(admin.token)).send({ lavadora_id: lavadoraId, secadora_id: secadoraId }).expect(200);

    const res = await request(app).patch(`/api/notas/${notaId}/terminar-secado`)
      .set(auth(admin.token)).send({ secadora_id: secadoraId });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('FINALIZADA');

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

  // Autoservicio también agrega máquinas (2026-09-25). Antes se rechazaba
  // porque se cobraba por adelantado y sumar una máquina a una nota ya pagada
  // la devolvía a PENDIENTE; hoy la nota nace pendiente y cada máquina se
  // tarifa al asignarla, así que la de más es un renglón más de la misma nota.
  it('asignar-maquina agrega una máquina más a una nota de Autoservicio', async () => {
    await seedAjustes({ precio_carga_mediana: 70 });
    const lavadoraId = await seedMaquina({ nombre: 'L-auto', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(nota.status).toBe(201);
    // La máquina que la nota traía elegida va por su ruta y ahí se tarifa.
    const asignada = await request(app).patch(`/api/notas/${nota.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: nota.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId })
      .expect(200);
    expect(Number(asignada.body.precio_total)).toBe(70);

    // Y la de más entra como carga nueva, con su tarifa.
    const otra = await seedMaquina({ nombre: 'S-auto', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).patch(`/api/notas/${nota.body.id}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: true });

    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(2);
    expect(Number(res.body.precio_total)).toBe(115); // 70 lavado + 45 secado
  });

  it('asignar-maquina agrega una carga nueva y suma su tarifa', async () => {
    const { notaId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: true });
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(2);
    // El servicio Chica de la nota (120) más la tarifa de la máquina agregada
    // con cobrar:true (70). La carga original ya no cobra su máquina: en Por
    // Encargo lo que se cobra es el precio del servicio.
    expect(Number(res.body.precio_total)).toBe(190);
    // La máquina agregada queda asignada pero sin iniciar (disponible).
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [otra]);
    expect(rows[0].estado).toBe('disponible');
  });

  // Una carga que ya lavó puede volver a lavar (o secar de más) en la misma
  // carga: el hueco lo ocupa la máquina PUESTA, no la que ya se usó. Y esa
  // repetición va sin cobro, así que no puede reescribir lo ya cobrado.
  it('una carga acepta otra lavadora cuando la suya ya se liberó, sin mover el total', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const cargaId = nota.body.cargas[0].id;
    const totalAntes = Number(nota.body.precio_total);
    expect(totalAntes).toBeGreaterThan(0);

    // Con la lavadora puesta, no cabe otra del mismo tipo a la vez.
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const ocupada = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: false, carga_id: cargaId });
    expect(ocupada.status).toBe(400);
    expect(ocupada.body.message).toMatch(/ya tiene una lavadora/i);

    // Se libera la lavadora (como al terminar su ciclo): queda el registro
    // histórico en lavadora_usada_id y el hueco vuelve a estar libre.
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE id = $1', [cargaId]);
    await pool.query("UPDATE maquinas SET estado = 'disponible' WHERE id = $1", [lavadoraId]);

    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: false, carga_id: cargaId });
    expect(res.status).toBe(200);
    // Ni carga nueva ni cambio de total: la segunda lavada va en la misma carga
    // y el lavado que sí se cobró sigue cobrado.
    expect(res.body.cargas).toHaveLength(1);
    expect(Number(res.body.precio_total)).toBe(totalAntes);
  });

  // El historial de la carga (mig. 114) guarda una fila POR PASADA, así que una
  // carga que se relava en la misma lavadora la lista dos veces. Los campos
  // viejos (lavadora_usada_id) solo saben de la última.
  it('una carga que repite lavadora la lista dos veces en su historial', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const carga = nota.body.cargas[0];
    expect(carga.maquinas_usadas).toHaveLength(1);
    expect(carga.maquinas_usadas[0]).toMatchObject({ slot: 'lavadora', nombre: 'Lavadora 1', actual: true });

    // Termina el lavado (la lavadora se suelta) y se vuelve a poner la MISMA.
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE id = $1', [carga.id]);
    await pool.query("UPDATE maquinas SET estado = 'disponible' WHERE id = $1", [lavadoraId]);
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId, cobrar: false, carga_id: carga.id });
    expect(res.status).toBe(200);

    const despues = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const usadas = despues.body.cargas[0].maquinas_usadas;
    expect(usadas).toHaveLength(2);
    expect(usadas.map(u => u.nombre)).toEqual(['Lavadora 1', 'Lavadora 1']);
    // Solo la última es la que el hueco tiene puesta ahora.
    expect(usadas.map(u => u.actual)).toEqual([false, true]);
  });

  // La vuelta extra va sin cobro sobre un lavado ya cobrado: darle dos ciclos
  // sería regalar el doble de agua y luz (mig. 115).
  it('la máquina agregada desde Salidas queda marcada de un solo ciclo', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const cargaId = nota.body.cargas[0].id;

    // El lavado que la nota compró no está marcado: corre lo que dé su marca.
    const { rows: primera } = await pool.query(
      'SELECT ciclo_unico FROM nota_carga_maquinas WHERE carga_id = $1 AND slot = $2', [cargaId, 'lavadora']
    );
    expect(primera[0].ciclo_unico).toBe(false);

    // Se libera y se agrega otra vuelta desde Salidas.
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE id = $1', [cargaId]);
    await pool.query("UPDATE maquinas SET estado = 'disponible' WHERE id = $1", [lavadoraId]);
    await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId, cobrar: false, carga_id: cargaId })
      .expect(200);

    const { rows: pasadas } = await pool.query(
      `SELECT ciclo_unico FROM nota_carga_maquinas
        WHERE carga_id = $1 AND slot = $2 ORDER BY asignada_at, id`, [cargaId, 'lavadora']
    );
    expect(pasadas.map(x => x.ciclo_unico)).toEqual([false, true]);
  });

  // El ciclo único es de la vuelta REPETIDA —relavar, secar de más sobre ropa
  // que ya dio su vuelta—, no de ir sin cobro. En Por Encargo TODAS las
  // máquinas se ponen desde Salidas y sin cobro, porque lo que se cobra es el
  // servicio: capar por ahí dejaba el lavado normal del cliente en un ciclo
  // aunque su modelo pidiera dos.
  it('una máquina nueva SIN cobro tampoco queda capada a un ciclo', async () => {
    const { notaId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora sin cobro', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_ids: [otra], cobrar: false });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT ncm.ciclo_unico
         FROM nota_carga_maquinas ncm JOIN nota_cargas nc ON nc.id = ncm.carga_id
        WHERE nc.nota_id = $1 AND ncm.maquina_id = $2`, [notaId, otra]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ciclo_unico).toBe(false);
  });

  it('una carga nueva COBRADA no queda capada a un ciclo', async () => {
    const { notaId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/asignar-maquina`)
      .set(auth(admin.token)).send({ maquina_id: otra, cobrar: true });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT ncm.ciclo_unico, nc.precio_lavadora
         FROM nota_carga_maquinas ncm JOIN nota_cargas nc ON nc.id = ncm.carga_id
        WHERE nc.nota_id = $1 AND nc.es_adicional ORDER BY ncm.id`, [notaId]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].precio_lavadora)).toBeGreaterThan(0);
    expect(rows[0].ciclo_unico).toBe(false);
  });

  it('cambiar de máquina corrige la pasada en curso, no agrega otra', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    const otra = await seedMaquina({ nombre: 'Lavadora 2', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/notas/${notaId}/cambiar-maquina`)
      .set(auth(admin.token)).send({ maquina_actual_id: lavadoraId, maquina_nueva_id: otra });
    expect(res.status).toBe(200);

    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const usadas = nota.body.cargas[0].maquinas_usadas;
    expect(usadas).toHaveLength(1);
    expect(usadas[0]).toMatchObject({ nombre: 'Lavadora 2', actual: true });
  });

  it('el historial conserva el nombre de una máquina borrada', async () => {
    const { notaId, lavadoraId } = await porEncargoEnEspera();
    await pool.query('UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1', [notaId]);
    await pool.query('DELETE FROM maquinas WHERE id = $1', [lavadoraId]);

    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    const usadas = nota.body.cargas[0].maquinas_usadas;
    expect(usadas).toHaveLength(1);
    expect(usadas[0]).toMatchObject({ nombre: 'Lavadora 1', maquina_id: null, actual: false });
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
    expect(Number(res.body.precio_total)).toBe(10);   // la carga aún vale $0 (sin máquina): solo el ajuste
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

  // Descobrar es una decisión de dinero y tiene una sola puerta: "Revertir
  // pago" del detalle, que exige motivo y la caja de ese cobro abierta. Por la
  // edición no se pasa, ni siendo admin: tener la regla en dos sitios obligaba
  // a escribirla dos veces y la de aquí ya se había quedado corta.
  it('el cobro NO se deshace desde la edición, ni para un admin', async () => {
    const { notaId } = await autoservicio({ estado_pago: 'PAGADO' });

    const res = await request(app).patch(`/api/notas/${notaId}`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Revertir pago/i);

    // Y el cobro se queda como estaba.
    const nota = await request(app).get(`/api/notas/${notaId}`).set(auth(admin.token));
    expect(nota.body.estado_pago).toBe('PAGADO');
  });

  // Cobrar por la edición sigue igual: lo que se cierra es el sentido contrario.
  it('cobrar desde la edición sigue funcionando', async () => {
    const { notaId } = await autoservicio({ estado_pago: 'PENDIENTE' });
    const res = await request(app).patch(`/api/notas/${notaId}`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(res.status).toBe(200);
    expect(res.body.estado_pago).toBe('PAGADO');
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
    expect(Number(res.body.precio_total)).toBe(35); // carga en $0 + 1 botella × 35

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
    expect(res.body.message).toMatch(/se cobra en/i);
  });
});

describe('permisos por rol', () => {
  it('un empleado no puede eliminar una nota (403); un admin sí (204)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [
        { lavadora_tipo: 'mediana' },
        { lavadora_tipo: 'mediana' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.cargas).toHaveLength(2);
    expect(res.body.estado).toBe('EN_ESPERA'); // nace sin máquina
    // Las dos cargas nacen en $0: se tarifan al asignarles su máquina.
    expect(Number(res.body.precio_total)).toBe(0);

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
    // La carga sigue guardando la tarifa jumbo de edredón (80) porque la nota
    // mandó el tipo de lavado, pero lo que se COBRA es el precio del servicio
    // Edredón (180): el tope manda sobre la suma de las máquinas.
    expect(Number(res.body.precio_total)).toBe(180);
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
    expect(res.body.message).toMatch(/se cobra en/i);
  });
});

describe('productos por tapa', () => {
  // En Por Encargo el granel es MATERIAL del servicio: se sirve por tapa, el
  // precio del servicio lo paga y no se cobra aparte. Lo que impide regalarlo
  // sin medida es el tope, no el cobro. Aquí la carga no tiene tamaño —nota
  // vieja, sin servicio vendido—, así que no hay tope y se cobra la máquina.
  it('en Por Encargo el granel de la nota no se cobra aparte, pero sí reserva stock', async () => {
    const clienteId = await seedCliente();
    const tapa = await seedProducto({ nombre: 'Suavizante', precio_unitario: 15, es_por_tapa: true });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: tapa, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(70); // solo el lavado
    const { rows } = await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [tapa]);
    expect(Number(rows[0].stock_reservado)).toBe(2);
  });

  // El de MARCA va igual: es el jabón con el que se lava, no una venta.
  it('en Por Encargo el producto de marca de la nota tampoco se cobra', async () => {
    const clienteId = await seedCliente();
    // Barato a propósito: el tope de la Chica (120) ya carga con su máquina
    // (mediana 70 + secadora 45), así que queda poco para el material.
    const marca = await seedProducto({
      nombre: 'Ensueño', tipo_liquido: 'marca', precio_unitario: 4, precio_botella: 4,
    });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE', cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
      productos: [{ producto_id: marca, cantidad: 1 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(120); // solo el servicio Chica
  });

  it('en Autoservicio el producto se vende por botella (precio_botella)', async () => {
    const prod = await seedProducto({ nombre: 'Suavizante', precio_botella: 15 });
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
      productos: [{ producto_id: prod, cantidad: 2 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(30); // lavado en $0 (sin máquina) + 2 botellas × 15
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
    // Nace PENDIENTE: el autoservicio se tarifa al asignar la máquina, así que
    // hasta entonces no hay nada que cobrar (2026-09-25).
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }, { lavadora_tipo: 'mediana' }],
    });
    return { notaId: crea.body.id, cargas: crea.body.cargas, lav1, lav2 };
  }

  const cobrar = (notaId) =>
    request(app).patch(`/api/notas/${notaId}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

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

  it('al terminar TODAS las cargas la nota se cierra', async () => {
    const { notaId, cargas, lav1, lav2 } = await notaDeDosCargas();

    await asignarYArrancar(notaId, cargas[0].id, lav1);
    await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav1 }).expect(200);

    await asignarYArrancar(notaId, cargas[1].id, lav2);
    // Ya con las dos máquinas asignadas la nota tiene precio y se puede cobrar.
    await cobrar(notaId);
    const res = await request(app).patch(`/api/notas/${notaId}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav2 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('FINALIZADA'); // autoservicio pagado
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

  // El cobro va SIEMPRE después de asignar la máquina (2026-09-25): antes de eso
  // el autoservicio vale $0 y el servidor no deja cobrarlo, así que un
  // `estado_pago: 'PAGADO'` en el body se traduce en cobrar al final.
  const terminarUnicaCarga = async ({ estado_pago, forma_pago, ...body } = {}) => {
    const lav = await seedMaquina({ nombre: `Lavadora ${Date.now()}`, tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token))
      .send({ tipo_prenda: 'ROPA', cargas: [{ lavadora_tipo: 'mediana' }], ...body,
              estado_pago: 'PENDIENTE' });
    expect(crea.status).toBe(201);
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    if (estado_pago === 'PAGADO') {
      await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(admin.token))
        .send({ estado_pago: 'PAGADO', forma_pago: forma_pago ?? 'EFECTIVO' }).expect(200);
    }
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

  // Un autoservicio que debe no se cierra al terminar su carga: FINALIZADA es
  // terminal y el cobro quedaría sin registrar. Espera en Por Entregar.
  it('autoservicio al que le revirtieron el pago: se queda en Por Entregar', async () => {
    const lav = await seedMaquina({ nombre: 'Lavadora rev', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(crea.status).toBe(201);
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE', motivo: 'se cobró de más' }).expect(200);

    const res = await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
  });

  // El autoservicio dejó de cobrarse por adelantado (2026-09-23): se crea
  // pendiente como Por Encargo, la carga corre igual y el cobro se registra
  // después desde el detalle. Al liquidarla ya no queda nada por hacer —el
  // cliente se llevó su ropa—, así que la nota se cierra sola y el producto
  // que tenía apartado sale del inventario, igual que cuando se cierra al
  // terminar la carga.
  it('autoservicio sin pagar: arranca igual, espera el cobro y al liquidarlo se cierra solo', async () => {
    const prod = await seedProducto({
      nombre: 'Detergente a deber', precio_botella: 30, stock_actual: 100,
      tipo_liquido: 'marca', botella_ml: 800, tapa_ml: 200,
    });
    const lav = await seedMaquina({ nombre: 'Lavadora sin pago', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    expect(crea.status).toBe(201);
    expect(crea.body.estado_pago).toBe('PENDIENTE');

    // Arranca sin haber cobrado: ya no hay candado.
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);

    // Terminada la carga espera el cobro en Por Entregar, con su producto
    // todavía apartado (no vendido).
    const fin = await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav });
    expect(fin.status).toBe(200);
    expect(fin.body.estado).toBe('LISTA');
    const enEspera = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(enEspera.rows[0].stock_actual)).toBe(100);
    expect(Number(enEspera.rows[0].stock_reservado)).toBeGreaterThan(0);
    const apartado = Number(enEspera.rows[0].stock_reservado);

    // Se liquida desde el detalle: la nota se cierra sola y el producto sale.
    const pago = await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(pago.status).toBe(200);
    expect(pago.body.estado_pago).toBe('PAGADO');
    expect(pago.body.estado).toBe('FINALIZADA');

    const despues = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(despues.rows[0].stock_actual)).toBe(100 - apartado);
    expect(Number(despues.rows[0].stock_reservado)).toBe(0);
  });

  // El cobro se puede deshacer y rehacer: lo que no puede es descontar dos veces
  // el mismo producto. La nota ya cerrada no vuelve a pasar por el cierre.
  it('re-cobrar una nota ya cerrada no descuenta el inventario otra vez', async () => {
    const prod = await seedProducto({
      nombre: 'Detergente recobro', precio_botella: 30, stock_actual: 100,
      tipo_liquido: 'marca', botella_ml: 800, tapa_ml: 200,
    });
    const lav = await seedMaquina({ nombre: 'Lavadora recobro', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav }).expect(200);

    const pagar = () => request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });

    const primera = await pagar();
    expect(primera.body.estado).toBe('FINALIZADA');
    const { rows: tras } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    const consumido = Number(tras[0].stock_actual);
    expect(consumido).toBeLessThan(100);
    expect(Number(tras[0].stock_reservado)).toBe(0);

    // Se revierte el cobro (la nota sigue FINALIZADA) y se vuelve a cobrar.
    await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PENDIENTE', motivo: 'se cobró de más' }).expect(200);
    const segunda = await pagar();
    expect(segunda.status).toBe(200);
    expect(segunda.body.estado).toBe('FINALIZADA');

    const { rows: fin } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(fin[0].stock_actual)).toBe(consumido);   // ni una tapa más
    expect(Number(fin[0].stock_reservado)).toBe(0);
  });

  // Borrar la nota es deshacerla entera: si su producto ya salió del estante al
  // cerrarse, tiene que volver. Antes solo volvía en la venta de mostrador, y
  // el autoservicio finalizado dejaba el inventario corto sin manera de
  // arreglarlo desde la nota.
  it('borrar una nota ya finalizada devuelve su producto al estante', async () => {
    const prod = await seedProducto({
      nombre: 'Detergente borrado', precio_botella: 30, stock_actual: 100,
      tipo_liquido: 'marca', botella_ml: 800, tapa_ml: 200,
    });
    const lav = await seedMaquina({ nombre: 'Lavadora borrado', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav }).expect(200);
    const pago = await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(pago.body.estado).toBe('FINALIZADA');
    const { rows: vendido } = await pool.query(
      'SELECT stock_actual FROM productos WHERE id = $1', [prod]);
    expect(Number(vendido[0].stock_actual)).toBeLessThan(100);

    await request(app).delete(`/api/notas/${crea.body.id}`).set(auth(admin.token)).expect(204);

    const { rows: fin } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(fin[0].stock_actual)).toBe(100);     // como si la nota nunca hubiera existido
    expect(Number(fin[0].stock_reservado)).toBe(0);
  });

  // Mientras le falte una carga, cobrarla NO la cierra: la ropa sigue adentro.
  it('cobrar un autoservicio que todavía tiene cargas pendientes no lo cierra', async () => {
    const lav = await seedMaquina({ nombre: 'Lavadora cobro', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(crea.status).toBe(201);
    // Se le asigna la máquina (ahí se tarifa) pero nadie la ha iniciado: es lo
    // mínimo para poder cobrar desde el 2026-09-25.
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
    const pago = await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(pago.status).toBe(200);
    expect(pago.body.estado).toBe('EN_ESPERA');
  });

  it('un autoservicio sin máquina asignada todavía no se puede cobrar', async () => {
    // La carga vale $0 hasta que se asigna la máquina en Salidas: cobrarla ahí
    // registraría un cobro de cero y al asignarla la nota se despagaría sola.
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const pago = await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' });
    expect(pago.status).toBe(409);
    expect(pago.body.message).toMatch(/asigna la máquina/i);
  });

  // El cierre a mano (cambiarEstadoNota) descuenta el producto del inventario al
  // finalizar. Al cerrarse sola la nota no pasa por ahí, así que el descuento
  // tiene que hacerlo el cierre automático: si no, el producto se queda
  // reservado para siempre y el inventario descuadrado.
  it('al cerrarse sola descuenta el producto del inventario, como el cierre a mano', async () => {
    const prod = await seedProducto({
      nombre: 'Detergente cierre', precio_botella: 30, stock_actual: 100,
      tipo_liquido: 'marca', botella_ml: 800, tapa_ml: 200,
    });
    const lav = await seedMaquina({ nombre: 'Lavadora stock', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    expect(crea.status).toBe(201);

    // Recién creada: el producto está apartado, todavía no vendido.
    const antes = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(antes.rows[0].stock_reservado)).toBeGreaterThan(0);
    const reservado = Number(antes.rows[0].stock_reservado);
    const stockInicial = Number(antes.rows[0].stock_actual);

    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    // Con la máquina ya asignada la nota tiene precio y se cobra (2026-09-25).
    await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    const res = await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav });
    expect(res.body.estado).toBe('FINALIZADA');

    // Ya vendido: sale del estante y deja de estar apartado.
    const despues = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(despues.rows[0].stock_actual)).toBe(stockInicial - reservado);
    expect(Number(despues.rows[0].stock_reservado)).toBe(0);

    // Y queda en el historial de inventario como una venta, no como un ajuste.
    const mov = await pool.query(
      `SELECT tipo FROM producto_movimientos WHERE nota_id = $1 AND producto_id = $2`,
      [crea.body.id, prod]);
    expect(mov.rows.map(r => r.tipo)).toEqual(['venta']);
  });

  // Terminar dos veces la misma carga antes solo reescribía LISTA (inofensivo);
  // ahora cierra la nota y descuenta inventario, así que repetirlo descuadraría
  // el stock. Lo impide la guarda de estado bajo el FOR UPDATE de la nota.
  it('terminar dos veces la misma carga no descuenta el producto dos veces', async () => {
    const prod = await seedProducto({
      nombre: 'Detergente doble', precio_botella: 30, stock_actual: 100,
      tipo_liquido: 'marca', botella_ml: 800, tapa_ml: 200,
    });
    const lav = await seedMaquina({ nombre: 'Lavadora doble', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana', productos: [{ producto_id: prod, cantidad: 1 }] }],
    });
    await arrancar(crea.body.id, crea.body.cargas[0].id, lav);
    await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(admin.token))
      .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav }).expect(200);
    const trasPrimera = await pool.query(
      'SELECT stock_actual FROM productos WHERE id = $1', [prod]);

    // El segundo intento se rechaza: la nota ya no está en proceso.
    const repetido = await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`)
      .set(auth(admin.token)).send({ lavadora_id: lav });
    expect(repetido.status).toBe(400);

    const trasSegunda = await pool.query(
      'SELECT stock_actual FROM productos WHERE id = $1', [prod]);
    expect(Number(trasSegunda.rows[0].stock_actual))
      .toBe(Number(trasPrimera.rows[0].stock_actual));
    // Y una sola venta en el historial de inventario.
    const mov = await pool.query(
      'SELECT tipo FROM producto_movimientos WHERE nota_id = $1 AND producto_id = $2',
      [crea.body.id, prod]);
    expect(mov.rows).toHaveLength(1);
  });

  // Por Encargo NO se cierra sola al terminar la máquina (2026-09-28): la ropa
  // lavada todavía hay que doblarla y empacarla, y quien lo dice es el botón
  // "Procesado". Se queda En Espera —que es donde está— pagada o no.
  it('por encargo sin pagar: termina su máquina y espera a que la procesen', async () => {
    const clienteId = await seedCliente();
    const res = await terminarUnicaCarga({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, estado_pago: 'PENDIENTE',
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('EN_ESPERA');
  });

  it('por encargo pagado: tampoco se adelanta a Por Entregar', async () => {
    const clienteId = await seedCliente();
    const res = await terminarUnicaCarga({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId,
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('EN_ESPERA');
  });
});

describe('cancelar una nota es cosa de administradores', () => {
  it('un empleado no puede cancelar', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const nota = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE', motivo: 'ya no la quiso' }).expect(200);
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
    // Solo cobra la carga que SÍ se usó: a la otra nunca se le asignó máquina,
    // y en Autoservicio la máquina es lo que pone el precio (2026-09-25).
    expect(Number(antes.body.precio_total)).toBe(70);

    const res = await request(app).delete(`/api/notas/${notaId}/cargas/${cargaSinUsar}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
    expect(Number(res.body.precio_total)).toBe(70); // la carga que se quitó no cobraba nada
    expect(res.body.cargas).toHaveLength(1);
  });

  // Quien se equivoca al agregar una máquina de más la quita en el momento: no
  // hace falta un admin (2026-09-25). El resto de las reglas no se movió.
  it('en Autoservicio cabe cualquier lavadora y se cobra la de esa máquina', async () => {
    // La nota no elige tamaño: guarda 'mediana' y el cliente usa la que esté
    // libre, así que una jumbo también se puede asignar y se cobra como jumbo.
    await seedAjustes({ precio_carga_mediana: 70, precio_carga_jumbo: 90 });
    const jumbo = await seedMaquina({ nombre: 'L-jumbo', tipo: 'lavadora_jumbo', tamano: 'jumbo' });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(crea.status).toBe(201);
    const res = await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`)
      .set(auth(admin.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: jumbo });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(90);
  });

  it('un empleado puede quitar una máquina que nunca arrancó', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
    const { notaId, cargaSinUsar, cargaUsada } = await notaConCargaTerminadaYOtraSinUsar();

    const res = await request(app).delete(`/api/notas/${notaId}/cargas/${cargaSinUsar}`)
      .set(auth(emp.token));
    expect(res.status).toBe(200);
    expect(res.body.cargas).toHaveLength(1);

    // Pero la que ya lavó sigue siendo historial, también para el empleado.
    const historial = await request(app).delete(`/api/notas/${notaId}/cargas/${cargaUsada}`)
      .set(auth(emp.token));
    expect(historial.status).toBe(409);
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
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


// Deshacer la entrega (2026-09-25): la nota entregada vuelve a Por Entregar,
// como antes de confirmarla. Es de admin y devuelve al inventario los productos
// que la entrega había dado por vendidos.
describe('PATCH /api/notas/:id/reabrir', () => {
  async function encargoEntregado() {
    const prod = await seedProducto({ nombre: 'Jabón entrega', precio_unitario: 10, stock_actual: 100 });
    const clienteId = await seedCliente();
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 150 });
    const crea = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana',
                 productos: [{ producto_id: prod, cantidad: 2 }] }],
    });
    expect(crea.status).toBe(201);
    const notaId = crea.body.id;
    // Lista → cobrada → entregada.
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'LISTA' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' }).expect(200);
    return { notaId, prod };
  }

  it('la nota entregada vuelve a Por Entregar sin mover el inventario', async () => {
    const { notaId, prod } = await encargoEntregado();
    // Entregada: el producto salió del estante y dejó de estar apartado.
    const { rows: vendido } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(vendido[0].stock_actual)).toBe(98);
    expect(Number(vendido[0].stock_reservado)).toBe(0);

    const res = await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('LISTA');
    // El cobro no se toca.
    expect(res.body.estado_pago).toBe('PAGADO');

    // El producto ya se usó en esta nota: no vuelve al estante ni se aparta.
    const { rows: igual } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(igual[0].stock_actual)).toBe(98);
    expect(Number(igual[0].stock_reservado)).toBe(0);
  });

  it('volver a entregarla no descuenta el producto dos veces', async () => {
    const { notaId, prod } = await encargoEntregado();
    await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token)).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' }).expect(200);

    const { rows } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(rows[0].stock_actual)).toBe(98);
    expect(Number(rows[0].stock_reservado)).toBe(0);
    // Y una sola venta en el historial de inventario.
    const mov = await pool.query(
      `SELECT tipo FROM producto_movimientos WHERE nota_id = $1 AND producto_id = $2`,
      [notaId, prod]);
    expect(mov.rows.filter(r => r.tipo === 'venta')).toHaveLength(1);
  });

  it('cancelar una nota reabierta devuelve el producto al estante', async () => {
    const { notaId, prod } = await encargoEntregado();
    await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token)).expect(200);
    // Cancelar exige revertir antes el cobro.
    await request(app).patch(`/api/notas/${notaId}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PENDIENTE', motivo: 'se reabrió por error' }).expect(200);
    await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'CANCELADA', motivo: 'ya no la quiso' }).expect(200);

    const { rows } = await pool.query(
      'SELECT stock_actual, stock_reservado FROM productos WHERE id = $1', [prod]);
    expect(Number(rows[0].stock_actual)).toBe(100);
    expect(Number(rows[0].stock_reservado)).toBe(0);
  });

  it('solo admin, y solo una nota ya entregada', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
    const { notaId } = await encargoEntregado();
    await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(emp.token)).expect(403);

    // Reabierta una vez, ya no se puede otra: sigue abierta.
    await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token)).expect(200);
    const res = await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sigue abierta/i);
  });

  it('se puede volver a entregar después de reabrirla', async () => {
    const { notaId } = await encargoEntregado();
    await request(app).patch(`/api/notas/${notaId}/reabrir`).set(auth(admin.token)).expect(200);
    const res = await request(app).patch(`/api/notas/${notaId}/estado`)
      .set(auth(admin.token)).send({ estado: 'FINALIZADA' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('FINALIZADA');
  });
});

// Ajuste de la nota desde Salidas (2026-09-25): descuento o cargo extra sobre
// el total, que además sale impreso en el ticket.
describe('PATCH /api/notas/:id/ajuste', () => {
  async function encargoDe150() {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_grande: 150 });
    const clienteId = await seedCliente();
    const res = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'POR_ENCARGO', cliente_id: clienteId, tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ tamano: 'grande', lavadora_tipo: 'mediana' }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.precio_total)).toBe(150);
    return res.body.id;
  }

  it('un descuento baja el total de la nota', async () => {
    const id = await encargoDe150();
    const res = await request(app).patch(`/api/notas/${id}/ajuste`)
      .set(auth(admin.token)).send({ ajuste: -20 });
    expect(res.status).toBe(200);
    expect(Number(res.body.ajuste)).toBe(-20);
    expect(Number(res.body.precio_total)).toBe(130);
  });

  it('un cargo extra lo sube, y el empleado también puede ponerlo', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
    const id = await encargoDe150();
    const res = await request(app).patch(`/api/notas/${id}/ajuste`)
      .set(auth(emp.token)).send({ ajuste: 30 });
    expect(res.status).toBe(200);
    expect(Number(res.body.precio_total)).toBe(180);
  });

  it('no deja el total en negativo ni acepta texto', async () => {
    const id = await encargoDe150();
    const negativo = await request(app).patch(`/api/notas/${id}/ajuste`)
      .set(auth(admin.token)).send({ ajuste: -500 });
    expect(negativo.status).toBe(400);
    expect(negativo.body.message).toMatch(/no puede ser negativo/i);
    // Y la nota se quedó como estaba.
    const det = await request(app).get(`/api/notas/${id}`).set(auth(admin.token));
    expect(Number(det.body.precio_total)).toBe(150);

    await request(app).patch(`/api/notas/${id}/ajuste`)
      .set(auth(admin.token)).send({ ajuste: 'mucho' }).expect(400);
  });

  it('si la nota estaba cobrada, el ajuste la deja pendiente por el importe nuevo', async () => {
    const id = await encargoDe150();
    await request(app).patch(`/api/notas/${id}/estado-pago`)
      .set(auth(admin.token)).send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);

    const res = await request(app).patch(`/api/notas/${id}/ajuste`)
      .set(auth(admin.token)).send({ ajuste: -20 });
    expect(res.status).toBe(200);
    expect(res.body.estado_pago).toBe('PENDIENTE');
    expect(Number(res.body.precio_total)).toBe(130);
  });
});
