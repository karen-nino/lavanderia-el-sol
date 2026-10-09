// Productos de marca de la demo pública (2026-10-08). La función es la misma
// que importa scripts/reset-demo.mjs; aquí corre contra la base de pruebas.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, auth } from '../helpers.js';
import { sembrarProductosMarcaDemo, PRODUCTOS_MARCA_DEMO } from '../../scripts/lib/productosDemo.js';

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('pruebas', 'Pruebas');
});

describe('sembrarProductosMarcaDemo', () => {
  it('crea los productos de marca, que se venden por unidad', async () => {
    expect(await sembrarProductosMarcaDemo(pool, 'pruebas')).toBe(PRODUCTOS_MARCA_DEMO.length);
    const admin = await seedUsuario({ rol: 'admin', sucursal: 'pruebas' });
    const res = await request(app).get('/api/productos').set(auth(admin.token, 'pruebas')).expect(200);
    const marca = res.body.filter((p) => p.tipo_liquido === 'marca');
    expect(marca).toHaveLength(PRODUCTOS_MARCA_DEMO.length);
    expect(marca.every((p) => p.se_vende_por_unidad && Number(p.stock_actual) === 24)).toBe(true);
  });

  it('es idempotente y deja las marcas en el catálogo', async () => {
    await sembrarProductosMarcaDemo(pool, 'pruebas');
    expect(await sembrarProductosMarcaDemo(pool, 'pruebas')).toBe(0);
    const { rows } = await pool.query("SELECT 1 FROM marcas_producto WHERE nombre IN ('Ariel', 'Ensueño')");
    expect(rows).toHaveLength(2);
  });
});
