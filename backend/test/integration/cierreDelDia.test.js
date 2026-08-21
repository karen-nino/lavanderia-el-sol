import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedLogin, seedMaquina, auth } from '../helpers.js';
import { liberarMaquinasCierreDelDia, cerrarSesionesEmpleados } from '../../jobs/cierreDelDia.js';

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
    expect(r).toEqual({ maquinasLiberadas: 1, notasListas: 1 });

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

  it('es idempotente: sin notas en proceso no cambia nada', async () => {
    const r = await liberarMaquinasCierreDelDia();
    expect(r).toEqual({ maquinasLiberadas: 0, notasListas: 0 });
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
