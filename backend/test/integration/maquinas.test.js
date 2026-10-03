import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, seedCliente, seedAjustes, auth, conTemporizador } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/maquinas — aislamiento por sucursal', () => {
  it('solo lista las máquinas de la sucursal activa', async () => {
    await seedSucursal('norte', 'Norte');
    await seedMaquina({ nombre: 'DelCentro', sucursal: 'centro' });
    await seedMaquina({ nombre: 'DelNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/maquinas').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nombre).toBe('DelCentro');
  });
});

describe('POST /api/maquinas — validaciones', () => {
  it('crea una máquina', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'mediana' });
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('L9');
    expect(res.body.sucursal).toBe('centro');
  });

  it('sin nombre o tipo → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo/i);
  });

  it('tipo inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'planchadora' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tipo de máquina válido/i);
  });

  it('tamaño inválido → 400', async () => {
    const res = await request(app).post('/api/maquinas').set(auth(admin.token))
      .send({ nombre: 'L9', tipo: 'lavadora_mediana', tamano: 'gigante' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tamaño válido/i);
  });
});

describe('PATCH /api/maquinas/:id/estado', () => {
  it('cambia el estado a mantenimiento', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'mantenimiento' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('mantenimiento');
  });

  it('estado inválido → 400', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).patch(`/api/maquinas/${id}/estado`).set(auth(admin.token))
      .send({ estado: 'roto' });
    expect(res.status).toBe(400);
  });

  it('máquina inexistente → 404', async () => {
    const res = await request(app).patch('/api/maquinas/999999/estado').set(auth(admin.token))
      .send({ estado: 'disponible' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/maquinas/:id', () => {
  it('un empleado no puede eliminar (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(empleado.token));
    expect(res.status).toBe(403);
  });

  it('el admin elimina una máquina', async () => {
    const id = await seedMaquina({ nombre: 'L1' });
    const res = await request(app).delete(`/api/maquinas/${id}`).set(auth(admin.token));
    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT id FROM maquinas WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('una máquina de otra sucursal → 404', async () => {
    await seedSucursal('norte', 'Norte');
    const ajena = await seedMaquina({ nombre: 'Ajena', sucursal: 'norte' });
    const res = await request(app).delete(`/api/maquinas/${ajena}`).set(auth(admin.token, 'centro'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/maquinas/:id/detener-ciclo — permiso por tipo', () => {
  it('un empleado NO puede detener una lavadora (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/administrador/i);
  });

  it('un empleado SÍ puede detener una secadora (200)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const sec = await seedMaquina({ nombre: 'S1', tipo: 'secadora', tamano: 'mediana' });
    const res = await request(app).patch(`/api/maquinas/${sec}/detener-ciclo`).set(auth(empleado.token));
    expect(res.status).toBe(200);
  });

  it('un admin SÍ puede detener una lavadora (200)', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const res = await request(app).patch(`/api/maquinas/${lav}/detener-ciclo`).set(auth(admin.token));
    expect(res.status).toBe(200);
  });
});

// Flujo de mostrador: el empleado levanta la nota y arranca la lavadora en
// Salidas; si algo sale mal (carga mal puesta, cliente que se arrepiente), el
// admin tiene que poder detenerla desde SU cuenta, sin depender del empleado.
describe('el admin detiene una lavadora que arrancó un empleado', () => {
  const estadoMaquina = async (id) =>
    (await pool.query('SELECT estado, en_uso_desde FROM maquinas WHERE id = $1', [id])).rows[0];
  const estadoNota = async (id) =>
    (await pool.query('SELECT estado FROM notas WHERE id = $1', [id])).rows[0].estado;

  // El empleado crea la nota, le asigna la lavadora (Salidas) y la arranca.
  async function empleadoArranca(tipo_servicio, nombreMaquina) {
    await seedAjustes({ precio_carga_mediana: 70, tope_carga_chico: 150 });
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: `Emp${nombreMaquina}` });
    const lavadoraId = await seedMaquina({ nombre: nombreMaquina, tipo: 'lavadora_mediana' });
    const cuerpo = {
      tipo_servicio, tipo_prenda: 'ROPA',
      ...(tipo_servicio === 'AUTOSERVICIO'
        ? { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }
        : { estado_pago: 'PENDIENTE' }),
      cargas: [tipo_servicio === 'POR_ENCARGO'
        ? { lavadora_tipo: 'mediana', tamano: 'chico' }
        : { lavadora_tipo: 'mediana' }],
      ...(tipo_servicio === 'POR_ENCARGO' ? { cliente_id: await seedCliente() } : {}),
    };
    const creada = await request(app).post('/api/notas').set(auth(empleado.token)).send(cuerpo);
    expect(creada.status).toBe(201);
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(empleado.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);
    await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`).set(auth(empleado.token))
      .send({ maquina_id: lavadoraId }).expect(200);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
    return { notaId: creada.body.id, lavadoraId, empleado };
  }

  for (const servicio of ['AUTOSERVICIO', 'POR_ENCARGO']) {
    it(`${servicio}: el admin la detiene y la nota vuelve a En Espera`, async () => {
      const { notaId, lavadoraId } = await empleadoArranca(servicio, `L-${servicio}`);

      await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`)
        .set(auth(admin.token)).expect(200);

      const m = await estadoMaquina(lavadoraId);
      expect(m.estado).toBe('disponible');
      expect(m.en_uso_desde).toBeNull();   // el temporizador se reinicia
      expect(await estadoNota(notaId)).toBe('EN_ESPERA');
    });
  }

  it('tras detenerla, el empleado puede volver a arrancarla', async () => {
    const { notaId, lavadoraId, empleado } = await empleadoArranca('AUTOSERVICIO', 'L-reinicio');
    await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`).set(auth(admin.token)).expect(200);

    await request(app).patch(`/api/notas/${notaId}/activar-pendientes`).set(auth(empleado.token))
      .send({ maquina_id: lavadoraId }).expect(200);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
  });

  it('un admin parado en otra sucursal no la toca (404) y la máquina sigue corriendo', async () => {
    await seedSucursal('norte', 'Norte');
    const { lavadoraId } = await empleadoArranca('AUTOSERVICIO', 'L-otra-suc');

    const res = await request(app).patch(`/api/maquinas/${lavadoraId}/detener-ciclo`)
      .set(auth(admin.token, 'norte'));
    expect(res.status).toBe(404);
    expect((await estadoMaquina(lavadoraId)).estado).toBe('en_uso');
  });
});

// El reporte de uso mide lo que la máquina lavó de verdad. Como varias notas
// pueden tenerla asignada a la vez, contar la asignación inflaba ciclos y
// dinero atribuido a esa máquina.
describe('GET /api/maquinas/:id/uso — solo cuenta el uso real', () => {
  it('ignora las notas que la tenían asignada pero nunca la arrancaron', async () => {
    await seedAjustes({ precio_carga_mediana: 70 });
    const lav = await seedMaquina({ nombre: 'L-uso', tipo: 'lavadora_mediana' });
    const crear = () => request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    const notas = [(await crear()).body, (await crear()).body, (await crear()).body];
    // Las tres la tienen asignada —ahí se tarifan (2026-09-25)— y las tres se
    // cobran; el reporte solo debe contar la que de verdad la usó.
    for (const n of notas) {
      await request(app).patch(`/api/notas/${n.id}/asignar-carga-maquina`).set(auth(admin.token))
        .send({ carga_id: n.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
      await request(app).patch(`/api/notas/${n.id}/estado-pago`).set(auth(admin.token))
        .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    }
    // Solo la primera le da a Iniciar.
    await request(app).patch(`/api/notas/${notas[0].id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav }).expect(200);

    const uso = await request(app).get(`/api/maquinas/${lav}/uso`).set(auth(admin.token));
    expect(uso.status).toBe(200);
    expect(uso.body.resumen.usos).toBe(1);
    expect(uso.body.resumen.cargas).toBe(1);
    expect(uso.body.resumen.generado).toBe(70);   // no 210
  });
});

// La marca `reservada` del listado avisa que otra nota ya tiene apartada esa
// máquina. No la bloquea (desde la mig. 097 se la queda quien arranque
// primero), pero es lo que evita que dos empleados manden ropa a la misma.
describe('GET /api/maquinas — marca de apartada', () => {
  // Sin pagar: estas notas solo apartan la máquina y una llega a cancelarse
  // (una nota ya cobrada no se cancela sin revertir el pago primero). Ninguna
  // arranca, que es lo único que exige el cobro por adelantado.
  const crearNota = () =>
    request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });

  const marcaDe = async (id) => {
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    return res.body.find((m) => m.id === id)?.reservada;
  };

  it('crear la nota (que solo elige TIPO de máquina) no aparta ninguna', async () => {
    const lav = await seedMaquina({ nombre: 'L0', tipo: 'lavadora_mediana' });
    await crearNota().expect(201);
    expect(await marcaDe(lav)).toBe(false);
  });

  it('asignar la máquina a una carga la deja apartada aunque no haya arrancado', async () => {
    const lav = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const nota = (await crearNota()).body;
    await request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: nota.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);

    expect(await marcaDe(lav)).toBe(true);
  });

  it('cancelar la nota suelta la máquina que tenía apartada', async () => {
    const lav = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana' });
    const nota = (await crearNota()).body;
    await request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: nota.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);

    await request(app).patch(`/api/notas/${nota.id}/estado`).set(auth(admin.token))
      .send({ estado: 'CANCELADA' }).expect(200);

    expect(await marcaDe(lav)).toBe(false);
  });
});

describe('GET /api/maquinas — quién tiene la máquina en uso', () => {
  // Usa los dos pasos del temporizador (encender, luego iniciar).
  conTemporizador();

  // Asignar no aparta: varias notas pueden tener la misma lavadora asignada y
  // se la queda la que le dé a Iniciar primero. "en_uso_folio" es lo único que
  // dice cuál fue, y resolverlo por la nota más ANTIGUA con la máquina asignada
  // señalaba a la equivocada en cuanto esa nota vieja tenía OTRA máquina
  // corriendo: en Salidas veía el ciclo ajeno como suyo, con su botón de
  // "Detener Lavado" al lado (2026-09-22).
  const crearNotaPagada = (cargas = 1) =>
    request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA',
      estado_pago: 'PAGADO', forma_pago: 'EFECTIVO',
      cargas: Array.from({ length: cargas }, () => ({ lavadora_tipo: 'mediana' })),
    });

  const asignar = (nota, indice, lav) =>
    request(app).patch(`/api/notas/${nota.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: nota.cargas[indice].id, slot: 'lavadora', maquina_id: lav });

  const encender = (nota, lav) =>
    request(app).patch(`/api/notas/${nota.id}/encender-maquina`).set(auth(admin.token))
      .send({ maquina_id: lav });

  const iniciar = (nota, lav) =>
    request(app).patch(`/api/notas/${nota.id}/activar-pendientes`).set(auth(admin.token))
      .send({ maquina_id: lav });

  const enUsoDe = async (id) => {
    const res = await request(app).get('/api/maquinas').set(auth(admin.token));
    return res.body.find((m) => m.id === id)?.en_uso_folio;
  };

  // La nota vieja queda LAVANDO por su PROPIA máquina (L2) y además tiene
  // asignada la que se pelea (L1), que nunca arrancó. Ese es el caso que
  // confundía a la consulta.
  const notaViejaLavando = async (enDisputa, propia) => {
    const vieja = (await crearNotaPagada(2).expect(201)).body;
    await asignar(vieja, 0, enDisputa).expect(200);
    await asignar(vieja, 1, propia).expect(200);
    await encender(vieja, propia).expect(200);
    await iniciar(vieja, propia).expect(200);
    return vieja;
  };

  it('la dueña es la que la arrancó, no la nota más vieja que la tenía asignada', async () => {
    await seedAjustes({ precio_carga_mediana: 70 });
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });

    const vieja = await notaViejaLavando(l1, l2);
    const nueva = (await crearNotaPagada().expect(201)).body;
    await asignar(nueva, 0, l1).expect(200);

    // La nota nueva le da a Iniciar primero: L1 es suya.
    await encender(nueva, l1).expect(200);
    await iniciar(nueva, l1).expect(200);

    expect(await enUsoDe(l1)).toBe(nueva.folio);
    expect(await enUsoDe(l2)).toBe(vieja.folio);
  });

  it('encendida y aún sin arrancar, ya es de la nota que la encendió', async () => {
    await seedAjustes({ precio_carga_mediana: 70 });
    const l1 = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana', tamano: 'mediana' });
    const l2 = await seedMaquina({ nombre: 'L2', tipo: 'lavadora_mediana', tamano: 'mediana' });

    await notaViejaLavando(l1, l2);
    const nueva = (await crearNotaPagada().expect(201)).body;
    await asignar(nueva, 0, l1).expect(200);
    await encender(nueva, l1).expect(200);

    expect(await enUsoDe(l1)).toBe(nueva.folio);
  });
});
