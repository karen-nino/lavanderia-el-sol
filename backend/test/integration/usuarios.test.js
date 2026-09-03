import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedLogin, seedMaquina, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/usuarios', () => {
  it('un admin ve empleados de todas las sucursales', async () => {
    await seedSucursal('norte', 'Norte');
    await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'DelCentro' });
    await seedUsuario({ rol: 'operador', sucursal: 'norte', nombre: 'DelNorte' });

    const res = await request(app).get('/api/usuarios').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    const nombres = res.body.map((u) => u.nombre);
    expect(nombres).toContain('DelCentro');
    expect(nombres).toContain('DelNorte');
  });
});

describe('POST /api/usuarios — crear empleado', () => {
  it('el admin crea un operador', async () => {
    const res = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Juan', apellido: 'Pérez', password: 'clave1234', rol: 'operador', sucursal: 'centro' });
    expect(res.status).toBe(201);
    expect(res.body.rol).toBe('operador');
    expect(res.body.sucursal).toBe('centro');
  });

  it('contraseña de menos de 6 caracteres → 400', async () => {
    const res = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Juan', password: 'corta', rol: 'operador' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6 caracteres/i);
  });

  it('nombre vacío → 400', async () => {
    const res = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: '  ', password: 'clave1234' });
    expect(res.status).toBe(400);
  });

  it('un admin normal no puede crear un admin_main → 403', async () => {
    const res = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Jefe', password: 'clave1234', rol: 'admin_main' });
    expect(res.status).toBe(403);
  });

  it('un empleado no puede crear usuarios (403)', async () => {
    const empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).post('/api/usuarios').set(auth(empleado.token))
      .send({ nombre: 'Juan', password: 'clave1234', rol: 'operador' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/usuarios/:id', () => {
  it('no puedes eliminar tu propio usuario (400)', async () => {
    const res = await request(app).delete(`/api/usuarios/${admin.id}`).set(auth(admin.token));
    expect(res.status).toBe(400);
  });

  it('el admin desactiva a un operador', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).delete(`/api/usuarios/${emp.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    // Ya no aparece en el listado de activos.
    const lista = await request(app).get('/api/usuarios').set(auth(admin.token));
    expect(lista.body.map((u) => u.id)).not.toContain(emp.id);
  });

  it('un admin normal no puede eliminar a otro administrador → 403', async () => {
    const otroAdmin = await seedUsuario({ rol: 'admin', sucursal: 'centro', nombre: 'OtroAdmin' });
    const res = await request(app).delete(`/api/usuarios/${otroAdmin.id}`).set(auth(admin.token));
    expect(res.status).toBe(403);
  });

  it('empleado inexistente → 404', async () => {
    const res = await request(app).delete('/api/usuarios/999999').set(auth(admin.token));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/usuarios/:id/desempeno', () => {
  it('empleado inexistente → 404', async () => {
    const res = await request(app).get('/api/usuarios/999999/desempeno').set(auth(admin.token));
    expect(res.status).toBe(404);
  });

  it('agrega por día las notas que creó el empleado', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Vendedor' });
    for (let i = 0; i < 2; i++) {
      await request(app).post('/api/notas').set(auth(emp.token)).send({
        tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PAGADO',
        cargas: [{ lavadora_tipo: 'mediana' }],
      }).expect(201);
    }

    const res = await request(app).get(`/api/usuarios/${emp.id}/desempeno`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.resumen.notas).toBe(2);
    expect(res.body.resumen.vendido).toBe(140); // 70 + 70
    expect(res.body.resumen.cargas).toBe(2);
    expect(res.body.dias).toHaveLength(1);
  });

  it('el check-in registra la entrada al primer login y la salida al cerrar sesión', async () => {
    // Usuario con contraseña real para poder pasar por el login (que crea el check-in).
    const u = await seedLogin({ rol: 'operador', nombre: 'Asistente', password: 'secret123' });

    const login = await request(app).post('/api/auth/login').send({ usuario_id: u.id, password: 'secret123' });
    expect(login.status).toBe(200);

    let res = await request(app).get(`/api/usuarios/${u.id}/desempeno`).set(auth(admin.token));
    expect(res.body.dias).toHaveLength(1);
    expect(res.body.dias[0].checkin).toMatch(/^\d{1,2}:\d{2} (am|pm)$/); // hora de entrada (12h)
    expect(res.body.dias[0].salida).toBeNull();

    // Cerrar sesión registra la salida del día.
    await request(app).post('/api/auth/logout').set(auth(login.body.token)).expect(200);

    res = await request(app).get(`/api/usuarios/${u.id}/desempeno`).set(auth(admin.token));
    expect(res.body.dias[0].salida).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
  });
});
