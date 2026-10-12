// POST /maquinas/revisar-sonoff (2026-10-11): el botón de refrescar de
// Máquinas pide leer los Sonoff al momento. En pruebas el driver es el de
// simulación, así que no hay nada real que leer: responde 0 y no toca nada.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedMaquina, auth } from '../helpers.js';

let empleado;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  empleado = await seedUsuario({ rol: 'operador', sucursal: 'centro', nombre: 'Mostrador' });
});

describe('POST /api/maquinas/revisar-sonoff', () => {
  it('cualquier usuario lo puede pedir; en simulación no revisa ni cambia nada', async () => {
    const maq = await seedMaquina({ nombre: 'L1', tipo: 'lavadora_mediana' });
    await pool.query(`UPDATE maquinas SET device_id = 'abc', estado = 'en_uso', en_uso_desde = NOW(),
                      encendida_manual_at = NOW() WHERE id = $1`, [maq]);
    const res = await request(app).post('/api/maquinas/revisar-sonoff').set(auth(empleado.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revisadas: 0 });
    const { rows } = await pool.query('SELECT estado FROM maquinas WHERE id = $1', [maq]);
    expect(rows[0].estado).toBe('en_uso');
  });

  it('sin sesión → 401', async () => {
    await request(app).post('/api/maquinas/revisar-sonoff').expect(401);
  });
});
