// Mig. 170: una nota pagada en un solo cobro (sin abonos) guarda quién cobró;
// `pagado_en` dice cuándo. Al revertir se limpian los dos.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedAjustes, auth } from '../helpers.js';

let admin;

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro', nombre: 'Karen' });
  await seedAjustes({ precio_carga_mediana: 0, precio_carga_secadora: 0 });
});

const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);

const notaChico = (estado_pago) => api('post', '/api/notas', {
  tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'ROPA', estado_pago,
  forma_pago: estado_pago === 'PAGADO' ? 'EFECTIVO' : undefined,
  cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
});

describe('quién cobró una nota pagada en un solo cobro', () => {
  it('pagada al crearla: cobró quien la creó, y el detalle lo dice', async () => {
    await api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);
    const { body } = await notaChico('PAGADO').expect(201);

    const { body: detalle } = await api('get', `/api/notas/${body.id}`).expect(200);
    expect(detalle.pagado_por).toBe(admin.id);
    expect(detalle.pagado_por_nombre).toBe('Karen');
    expect(detalle.pagado_en).toBeTruthy();
  });

  it('marcada pagada después: cobró quien la marcó; al revertir se limpia', async () => {
    await api('post', '/api/caja/abrir', { monto_inicial: 0 }).expect(201);
    const { body } = await notaChico('PENDIENTE').expect(201);
    expect((await api('get', `/api/notas/${body.id}`)).body.pagado_por).toBeNull();

    await api('patch', `/api/notas/${body.id}/estado-pago`, { estado_pago: 'PAGADO', forma_pago: 'EFECTIVO' }).expect(200);
    expect((await api('get', `/api/notas/${body.id}`)).body.pagado_por).toBe(admin.id);

    await api('patch', `/api/notas/${body.id}/estado-pago`, { estado_pago: 'PENDIENTE', motivo: 'Error' }).expect(200);
    const { rows } = await pool.query('SELECT pagado_por, pagado_en FROM notas WHERE id = $1', [body.id]);
    expect(rows[0]).toEqual({ pagado_por: null, pagado_en: null });
  });
});
