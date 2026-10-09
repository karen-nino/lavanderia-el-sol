// El mismo producto puede ir DENTRO de un servicio (Por Encargo) y SUELTO en la
// nota. Los botones de Salidas (+, −, quitar) son del suelto: no pueden tocar
// el del servicio ni descuadrar lo apartado en inventario (2026-10-08).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { pool, limpiarBase, seedSucursal, seedUsuario, seedProducto, seedAjustes, seedCliente, auth } from '../helpers.js';

let admin;
let azul;
beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedAjustes({ precarga_medidas_chico: 1, precio_carga_mediana: 0, precio_carga_secadora: 0 });
  admin = await seedUsuario({ rol: 'admin', sucursal: 'centro' });
  const { rows } = await pool.query(`INSERT INTO tipos_granel (nombre, orden) VALUES ('Suavizante', 1) RETURNING id`);
  azul = await seedProducto({ nombre: 'SE AZUL', precio_unitario: 1, stock_actual: 50 });
  await pool.query('UPDATE productos SET tipo_granel_id = $2 WHERE id = $1', [azul, rows[0].id]);
});
const api = (m, url, body) => request(app)[m](url).set(auth(admin.token)).send(body);
const reservado = async () =>
  Number((await pool.query('SELECT stock_reservado FROM productos WHERE id = $1', [azul])).rows[0].stock_reservado);
const filas = async (notaId) => (await pool.query(
  'SELECT carga_id IS NOT NULL AS en_servicio, cantidad::int AS cantidad FROM nota_productos WHERE nota_id = $1 ORDER BY carga_id NULLS LAST',
  [notaId])).rows;

async function notaConSuavizanteEnServicioYSuelto() {
  const cli = await seedCliente();
  const n = await api('post', '/api/notas', {
    tipo_servicio: 'POR_ENCARGO', cliente_id: cli, tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE',
    cargas: [{ tamano: 'chico', tipo_prenda: 'ROPA' }],
  });
  expect(n.status).toBe(201);
  await api('post', `/api/notas/${n.body.id}/productos`, { producto_id: azul, cantidad: 2 }).expect(201);
  expect(await filas(n.body.id)).toEqual([{ en_servicio: true, cantidad: 1 }, { en_servicio: false, cantidad: 2 }]);
  expect(await reservado()).toBe(3);
  return n.body.id;
}

describe('producto suelto y el mismo dentro de un servicio', () => {
  it('cambiar la cantidad del suelto no toca el del servicio', async () => {
    const id = await notaConSuavizanteEnServicioYSuelto();
    await api('patch', `/api/notas/${id}/productos/${azul}`, { cantidad: 3 }).expect(200);
    expect(await filas(id)).toEqual([{ en_servicio: true, cantidad: 1 }, { en_servicio: false, cantidad: 3 }]);
    expect(await reservado()).toBe(4);
  });

  it('quitar el suelto deja el del servicio y devuelve solo lo suyo', async () => {
    const id = await notaConSuavizanteEnServicioYSuelto();
    await api('delete', `/api/notas/${id}/productos/${azul}`).expect(204);
    expect(await filas(id)).toEqual([{ en_servicio: true, cantidad: 1 }]);
    expect(await reservado()).toBe(1);
  });
});

describe('pedir más de un producto que ya está en la nota', () => {
  it('las unidades ya puestas conservan su precio aunque el catálogo cambie', async () => {
    const marca = await seedProducto({ nombre: 'ARIEL', precio_unitario: 20, precio_botella: 20, tipo_liquido: 'marca' });
    const n = await api('post', '/api/notas', {
      tipo_servicio: 'AUTOSERVICIO', tipo_prenda: 'ROPA', estado_pago: 'PENDIENTE', cargas: [{ lavadora_tipo: 'mediana' }],
    });
    await api('post', `/api/notas/${n.body.id}/productos`, { producto_id: marca, cantidad: 1 }).expect(201);
    const antes = Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [n.body.id])).rows[0].precio_total);
    await pool.query('UPDATE productos SET precio_unitario = precio_unitario + 5, precio_botella = COALESCE(precio_botella, 0) + 5 WHERE id = $1', [marca]);
    await api('post', `/api/notas/${n.body.id}/productos`, { producto_id: marca, cantidad: 1 }).expect(201);
    const despues = Number((await pool.query('SELECT precio_total FROM notas WHERE id = $1', [n.body.id])).rows[0].precio_total);
    // La segunda unidad se suma al renglón con su precio congelado: no
    // re-tarifa la primera (antes subía $30: $25 nuevos + $5 de la vieja).
    expect(despues - antes).toBe(antes);
  });
});
