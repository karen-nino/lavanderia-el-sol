import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedLogin, seedMaquina, auth } from '../helpers.js';
import { liberarMaquinasCierreDelDia, cerrarSesionesEmpleados, cerrarCajasAbiertas } from '../../jobs/cierreDelDia.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('liberarMaquinasCierreDelDia', () => {
  it('cierra las notas en proceso como LISTA y libera sus máquinas', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    // Nuevo flujo: asignar la lavadora física (Salidas) y arrancarla → LAVANDO.
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId });
    const arranque = await request(app).patch(`/api/notas/${creada.body.id}/activar-pendientes`)
      .set(auth(admin.token)).send({ maquina_id: lavadoraId });
    expect(arranque.body.estado).toBe('LAVANDO');

    const r = await liberarMaquinasCierreDelDia();
    expect(r).toEqual({ maquinasLiberadas: 1, notasListas: 1, cargasSueltas: 0 });

    // La nota quedó LISTA y la máquina disponible.
    const { rows: nota } = await pool.query('SELECT estado FROM notas WHERE id = $1', [creada.body.id]);
    expect(nota[0].estado).toBe('LISTA');
    const { rows: maq } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [lavadoraId]);
    expect(maq[0].estado).toBe('disponible');

    // La carga soltó la máquina viva pero la conserva como "usada" (historial).
    const { rows: carga } = await pool.query(
      'SELECT lavadora_id, lavadora_usada_id FROM nota_cargas WHERE nota_id = $1', [creada.body.id]
    );
    expect(carga[0].lavadora_id).toBeNull();
    expect(carga[0].lavadora_usada_id).toBe(lavadoraId);
  });

  // Una máquina asignada que nadie arrancó dejaba la nota En Espera con su
  // lavadora colgada un día tras otro. El barrido la suelta y la nota sigue
  // viva, lista para que le asignen máquina cuando el cliente vuelva.
  it('suelta las máquinas asignadas que nunca se arrancaron y deja viva la nota', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'L-sin-arrancar', tipo: 'lavadora_mediana' });
    const creada = await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    });
    expect(creada.status).toBe(201);
    await request(app).patch(`/api/notas/${creada.body.id}/asignar-carga-maquina`).set(auth(admin.token))
      .send({ carga_id: creada.body.cargas[0].id, slot: 'lavadora', maquina_id: lavadoraId }).expect(200);

    const r = await liberarMaquinasCierreDelDia();
    expect(r.cargasSueltas).toBe(1);

    // La nota sigue En Espera, pero su carga ya no retiene la lavadora…
    const { rows: nota } = await pool.query('SELECT estado FROM notas WHERE id = $1', [creada.body.id]);
    expect(nota[0].estado).toBe('EN_ESPERA');
    const { rows: carga } = await pool.query(
      'SELECT lavadora_id, lavadora_usada_id, lavadora_tipo FROM nota_cargas WHERE nota_id = $1', [creada.body.id]
    );
    expect(carga[0].lavadora_id).toBeNull();
    expect(carga[0].lavadora_usada_id).toBeNull();   // nunca lavó: no es historial
    expect(carga[0].lavadora_tipo).toBe('mediana');  // conserva el tipo para reasignarla

    // …y la máquina vuelve a ofrecerse sin marca de reservada.
    const lista = await request(app).get('/api/maquinas').set(auth(admin.token));
    const m = lista.body.find(x => x.id === lavadoraId);
    expect(m.estado).toBe('disponible');
    expect(m.reservada).toBe(false);
  });

  it('es idempotente: sin notas en proceso no cambia nada', async () => {
    const r = await liberarMaquinasCierreDelDia();
    expect(r).toEqual({ maquinasLiberadas: 0, notasListas: 0, cargasSueltas: 0 });
  });
});

describe('cerrarSesionesEmpleados', () => {
  it('invalida la sesión de los empleados y conserva la de los admin', async () => {
    // Empleado con contraseña real: inicia sesión (queda session_id) y luego
    // el cierre del día debe invalidar su token.
    const emp = await seedLogin({ rol: 'operador', nombre: 'Empleado', password: 'secret123' });
    const adminLogin = await seedLogin({ rol: 'admin', nombre: 'AdminReal', password: 'secret123' });

    const empLogin = await request(app).post('/api/auth/login').send({ usuario_id: emp.id, password: 'secret123' });
    const adminSesion = await request(app).post('/api/auth/login').send({ usuario_id: adminLogin.id, password: 'secret123' });

    const cerradas = await cerrarSesionesEmpleados();
    expect(cerradas).toBe(1); // solo el operador

    // El token del empleado ya no sirve.
    const empMe = await request(app).get('/api/auth/me').set(auth(empLogin.body.token));
    expect(empMe.status).toBe(401);
    expect(empMe.body.message).toMatch(/otro dispositivo/i);

    // El del admin sigue vigente.
    const adminMe = await request(app).get('/api/auth/me').set(auth(adminSesion.body.token));
    expect(adminMe.status).toBe(200);
  });
});

describe('cerrarCajasAbiertas', () => {
  it('cierra la caja que nadie cerró, sin conteo y marcada como automática', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token))
      .send({ monto_inicial: 500, notas: 'fondo del día' });

    const cerradas = await cerrarCajasAbiertas();
    expect(cerradas).toHaveLength(1);

    const { rows } = await pool.query('SELECT * FROM cajas WHERE id = $1', [cerradas[0].id]);
    expect(rows[0].estado).toBe('cerrada');
    expect(rows[0].cierre_automatico).toBe(true);
    // Nadie contó el cajón: inventar un monto contado sería fabricar un corte.
    expect(rows[0].monto_contado).toBeNull();
    expect(rows[0].usuario_cierre_id).toBeNull();
    expect(rows[0].cerrada_at).not.toBeNull();
  });

  it('deja abrir caja al día siguiente (era el bloqueo que causaba el problema)', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 500 });

    // Con la caja de ayer todavía abierta, nadie puede abrir la de hoy.
    const bloqueada = await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 300 });
    expect(bloqueada.status).toBe(409);

    await cerrarCajasAbiertas();

    const nueva = await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 300 });
    expect(nueva.status).toBe(201);
  });

  it('el corte automático aparece en el historial sin diferencia', async () => {
    await request(app).post('/api/caja/abrir').set(auth(admin.token)).send({ monto_inicial: 500 });
    await request(app).post('/api/caja/movimientos').set(auth(admin.token))
      .send({ tipo: 'salida', concepto: 'compra de jabón', monto: 100 });

    await cerrarCajasAbiertas();

    const hist = await request(app).get('/api/caja/historial').set(auth(admin.token));
    expect(hist.status).toBe(200);
    expect(hist.body).toHaveLength(1);
    const corte = hist.body[0];
    expect(corte.cierre_automatico).toBe(true);
    expect(corte.esperado).toBe(400);   // 500 de fondo - 100 de salida
    expect(corte.contado).toBeNull();
    // Sin conteo no hay faltante ni sobrante que reportar: inventar una
    // diferencia contra un cajón que nadie contó es peor que no tener dato.
    expect(corte.diferencia).toBeNull();
  });

  it('no hace nada si no hay cajas abiertas', async () => {
    expect(await cerrarCajasAbiertas()).toEqual([]);
  });
});
