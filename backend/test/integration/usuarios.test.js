import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import pool from '../../db/pool.js';
import { limpiarBase, seedSucursal, seedUsuario, seedLogin, seedMaquina, seedCliente, seedAjustes, seedProducto, auth } from '../helpers.js';

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

// Dos usuarios activos no pueden llamarse igual: el login elige a la persona
// por su nombre completo (2026-10-03).
describe('nombre repetido', () => {
  it('no se crea otro usuario con el mismo nombre completo, sin importar acentos ni mayúsculas', async () => {
    await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', password: 'clave1234', rol: 'admin' }).expect(201);

    const res = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: '  rebéca ', password: 'clave1234', rol: 'operador', sucursal: 'centro' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Ya hay un usuario llamado "Rebeca"/);
  });

  it('con apellido distinto sí se puede', async () => {
    await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', password: 'clave1234', rol: 'admin' }).expect(201);
    await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', apellido: 'Ruiz', password: 'clave1234', rol: 'operador', sucursal: 'centro' })
      .expect(201);
  });

  it('al editar tampoco puede quedar igual que otro', async () => {
    await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', password: 'clave1234', rol: 'operador', sucursal: 'centro' }).expect(201);
    const otro = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Ana', password: 'clave1234', rol: 'operador', sucursal: 'centro' }).expect(201);

    const res = await request(app).patch(`/api/usuarios/${otro.body.id}`).set(auth(admin.token))
      .send({ nombre: 'REBECA' });
    expect(res.status).toBe(409);

    // Guardarse a sí mismo con su propio nombre no choca consigo.
    await request(app).patch(`/api/usuarios/${otro.body.id}`).set(auth(admin.token))
      .send({ nombre: 'Ana' }).expect(200);
  });

  it('un usuario dado de baja no aparta su nombre', async () => {
    const r = await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', password: 'clave1234', rol: 'operador', sucursal: 'centro' }).expect(201);
    await request(app).delete(`/api/usuarios/${r.body.id}`).set(auth(admin.token)).expect(200);
    await request(app).post('/api/usuarios').set(auth(admin.token))
      .send({ nombre: 'Rebeca', password: 'clave1234', rol: 'operador', sucursal: 'centro' }).expect(201);
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
      // El autoservicio se tarifa al asignarle la máquina (2026-09-25): sin ese
      // paso la nota valdría $0 y no habría nada vendido que agregar.
      const lav = await seedMaquina({ nombre: `Lavadora ${i + 1}`, tipo: 'lavadora_mediana' });
      const crea = await request(app).post('/api/notas').set(auth(emp.token)).send({
        tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
        cargas: [{ lavadora_tipo: 'mediana' }],
      }).expect(201);
      await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(emp.token))
        .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
      await request(app).patch(`/api/notas/${crea.body.id}/estado-pago`).set(auth(emp.token))
        .send({ estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
      // Un ciclo cuenta cuando la máquina arranca (2026-10-06).
      await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(emp.token))
        .send({ maquina_id: lav }).expect(200);
      if (i === 0) {
        await request(app).patch(`/api/notas/${crea.body.id}/terminar-lavado-final`).set(auth(emp.token))
          .send({ lavadora_id: lav }).expect(200);
      }
    }

    const res = await request(app).get(`/api/usuarios/${emp.id}/desempeno`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.resumen.notas).toBe(2);
    expect(res.body.resumen.vendido).toBe(140); // 70 + 70
    expect(res.body.resumen.cargas).toBe(2);    // ciclos
    expect(res.body.dias).toHaveLength(1);

    // Cada ciclo trae su máquina, lo cobrado y su horario: el finalizado con
    // inicio, fin y tiempo encendida; el que sigue corriendo, solo su inicio.
    const ciclos = res.body.dias[0].detalle.cargas;
    const fin = ciclos.find((c) => c.descripcion === 'Lavadora 1');
    const vivo = ciclos.find((c) => c.descripcion === 'Lavadora 2');
    expect(fin.precio).toBe(70);
    expect(fin.inicio_at).toBeTruthy();
    expect(fin.fin_at).toBeTruthy();
    expect(fin.segundos).toBeGreaterThanOrEqual(0);
    expect(vivo.inicio_at).toBeTruthy();
    expect(vivo.fin_at).toBeNull();
  });

  it('el ciclo de Por Encargo vale la tarifa de la máquina, como en Información de uso', async () => {
    await seedAjustes({ precio_carga_mediana: 55 });
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Encargos' });
    const lav = await seedMaquina({ nombre: 'Lavadora E', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(emp.token)).send({
      tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cliente_id: await seedCliente(),
      cargas: [{ lavadora_tipo: 'mediana', tamano: 'chico' }],
    }).expect(201);
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(emp.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);
    await request(app).patch(`/api/notas/${crea.body.id}/activar-pendientes`).set(auth(emp.token))
      .send({ maquina_id: lav }).expect(200);

    const res = await request(app).get(`/api/usuarios/${emp.id}/desempeno`).set(auth(admin.token));
    expect(res.body.dias[0].detalle.cargas[0].precio).toBe(55);
  });

  it('en Productos, el granel dice "Granel" en la marca', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Granelero' });
    const granel = await seedProducto({ nombre: 'PERSIL', tipo_liquido: 'granel' });
    const crea = await request(app).post('/api/notas').set(auth(emp.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    await pool.query(
      'INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 1, 10)',
      [crea.body.id, granel]
    );

    const res = await request(app).get(`/api/usuarios/${emp.id}/desempeno`).set(auth(admin.token));
    const persil = res.body.dias[0].detalle.productos.find((p) => p.nombre === 'PERSIL');
    expect(persil.marca).toBe('Granel');
  });

  it('una máquina asignada que nunca arrancó no cuenta como ciclo', async () => {
    const emp = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'SinArrancar' });
    const lav = await seedMaquina({ nombre: 'Lavadora X', tipo: 'lavadora_mediana' });
    const crea = await request(app).post('/api/notas').set(auth(emp.token)).send({
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_tipo: 'mediana' }],
    }).expect(201);
    await request(app).patch(`/api/notas/${crea.body.id}/asignar-carga-maquina`).set(auth(emp.token))
      .send({ carga_id: crea.body.cargas[0].id, slot: 'lavadora', maquina_id: lav }).expect(200);

    const res = await request(app).get(`/api/usuarios/${emp.id}/desempeno`).set(auth(admin.token));
    expect(res.body.resumen.cargas).toBe(0);
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
