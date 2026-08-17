import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { limpiarBase, seedSucursal, seedUsuario, seedMaquina, auth } from '../helpers.js';

// Ventas deriva las cargas y el total desde nota_cargas (ya no de las columnas
// denormalizadas de la nota). Este smoke test ejerce ambas consultas (lista y
// corte) para atrapar cualquier referencia a columnas eliminadas.
let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
});

describe('GET /api/ventas/resumen', () => {
  it('responde con la estructura esperada y cuenta las cargas por nota', async () => {
    const lavadoraId = await seedMaquina({ nombre: 'Lavadora 1', tipo: 'lavadora_mediana' });
    await request(app).post('/api/notas').set(auth(admin.token)).send({
      tipo_servicio: 'AUTOSERVICIO',
      tipo_prenda: 'ROPA',
      estado_pago: 'PENDIENTE',
      cargas: [{ lavadora_id: lavadoraId, activar: true }],
    }).expect(201);

    const res = await request(app)
      .get('/api/ventas/resumen?periodo=hoy')
      .set(auth(admin.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tarjetas');
    expect(res.body).toHaveProperty('corte');
    expect(Array.isArray(res.body.lista_notas)).toBe(true);
    expect(res.body.lista_notas).toHaveLength(1);
    expect(res.body.lista_notas[0].cargas).toBe(1);
    expect(res.body.lista_notas[0].maquinas).toEqual([{ nombre: 'Lavadora 1', cargas: 1 }]);
  });

  it('requiere rol admin (un operador recibe 403)', async () => {
    const operador = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Empleado' });
    const res = await request(app).get('/api/ventas/resumen?periodo=hoy').set(auth(operador.token));
    expect(res.status).toBe(403);
  });
});
