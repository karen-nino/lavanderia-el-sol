// "Edredón": un Por Encargo de puro edredón con su lavadora terminada se ve así
// en la lista en vez de En Espera, en las sucursales donde el edredón no pasa
// por secadora (Retiro y Zapopan).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedAjustes, auth } from '../helpers.js';

beforeEach(async () => {
  await limpiarBase();
  await seedAjustes({ tope_carga_edredon: 200 });
});

/** Nota de edredón en `sucursal` con la lavadora ya usada y soltada. */
async function edredonLavado(sucursal) {
  await seedSucursal(sucursal, sucursal);
  const admin = await seedUsuario({ rol: 'admin', sucursal, nombre: `Admin ${sucursal}` });
  const nota = await request(app).post('/api/notas').set(auth(admin.token, sucursal)).send({
    tipo_servicio: 'POR_ENCARGO', tipo_prenda: 'EDREDON', estado_pago: 'PENDIENTE',
    cargas: [{ tipo_prenda: 'EDREDON' }],
  }).expect(201);
  const { rows: [m] } = await pool.query(
    `INSERT INTO maquinas (nombre, tipo, estado, sucursal)
     VALUES ('L1', 'lavadora_mediana', 'disponible', $1) RETURNING id`, [sucursal]);
  await pool.query(
    `UPDATE nota_cargas SET lavadora_usada_id = $2, lavadora_iniciada_at = NOW() - INTERVAL '1 hour'
      WHERE nota_id = $1`, [nota.body.id, m.id]);
  const lista = await request(app).get('/api/notas').set(auth(admin.token, sucursal));
  return lista.body.find(n => n.id === nota.body.id) ?? (lista.body.notas ?? []).find(n => n.id === nota.body.id);
}

describe('etiqueta Edredón en la lista de notas', () => {
  it('en Zapopan, como en Retiro, se ve Edredón al terminar la lavadora', async () => {
    expect((await edredonLavado('zapopan')).edredon).toBe(true);
    expect((await edredonLavado('retiro')).edredon).toBe(true);
  });

  it('en otra sucursal sigue En Espera', async () => {
    expect((await edredonLavado('centro')).edredon).toBe(false);
  });
});
