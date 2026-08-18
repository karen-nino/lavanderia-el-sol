import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedNotificacion, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/notificaciones', () => {
  it('lista las de la sucursal activa (aislamiento)', async () => {
    await seedSucursal('norte', 'Norte');
    await seedNotificacion({ mensaje: 'DeCentro', sucursal: 'centro' });
    await seedNotificacion({ mensaje: 'DeNorte', sucursal: 'norte' });

    const res = await request(app).get('/api/notificaciones').set(auth(admin.token, 'centro'));
    expect(res.status).toBe(200);
    expect(res.body.map((n) => n.mensaje)).toEqual(['DeCentro']);
  });

  it('no muestra las de más de 24 horas', async () => {
    await seedNotificacion({ mensaje: 'Reciente', sucursal: 'centro', minutosAtras: 10 });
    await seedNotificacion({ mensaje: 'Vieja', sucursal: 'centro', minutosAtras: 60 * 25 });

    const res = await request(app).get('/api/notificaciones').set(auth(admin.token));
    expect(res.body.map((n) => n.mensaje)).toEqual(['Reciente']);
  });
});

describe('POST /api/notificaciones/:id/descartar', () => {
  it('descarta solo para el usuario actual; otro usuario la sigue viendo', async () => {
    const otro = await seedUsuario({ rol: 'admin', sucursal: 'centro', nombre: 'Otro' });
    const notiId = await seedNotificacion({ mensaje: 'Aviso', sucursal: 'centro' });

    await request(app).post(`/api/notificaciones/${notiId}/descartar`).set(auth(admin.token)).expect(204);

    const paraAdmin = await request(app).get('/api/notificaciones').set(auth(admin.token));
    expect(paraAdmin.body).toHaveLength(0); // ya la descartó

    const paraOtro = await request(app).get('/api/notificaciones').set(auth(otro.token));
    expect(paraOtro.body.map((n) => n.mensaje)).toContain('Aviso'); // el otro sí la ve
  });

  it('notificación inexistente → 404', async () => {
    const res = await request(app).post('/api/notificaciones/999999/descartar').set(auth(admin.token));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/notificaciones/descartar-todas', () => {
  it('descarta todas las de la campana para el usuario actual', async () => {
    await seedNotificacion({ mensaje: 'Uno', sucursal: 'centro' });
    await seedNotificacion({ mensaje: 'Dos', sucursal: 'centro' });

    await request(app).post('/api/notificaciones/descartar-todas').set(auth(admin.token)).expect(204);

    const res = await request(app).get('/api/notificaciones').set(auth(admin.token));
    expect(res.body).toHaveLength(0);
  });
});
