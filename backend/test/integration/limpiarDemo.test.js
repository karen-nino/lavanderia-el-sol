// El reset nocturno de la demo borra la operación que dejaron los visitantes.
// Su punto frágil es el ORDEN: notas, cajas, movimientos_caja y
// movimientos_insumos apuntan a usuarios con ON DELETE RESTRICT, así que una
// sola fila mal ordenada tumba la transacción entera y la demo se queda sin
// restaurar hasta que alguien entra a la base a mano.
//
// Estas pruebas ejecutan la secuencia de verdad (scripts/lib/limpiarDemo.js,
// la misma que importa reset-demo.mjs) contra una base con el escenario que
// rompía: un usuario dado de alta por un visitante que acabó operando en una
// sucursal real, con caja, inventario y notas a su nombre.
import { describe, it, expect, beforeEach } from 'vitest';
import { pool, limpiarBase, seedSucursal, seedProducto, seedMaquina, seedCliente } from '../helpers.js';
import {
  limpiarOperacion,
  borrarUsuariosDeVisitantes,
  borrarCatalogos,
} from '../../scripts/lib/limpiarDemo.js';

const uno = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const cuantos = async (tabla) =>
  Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`)).rows[0].n);

beforeEach(async () => {
  await limpiarBase();
  await seedSucursal('centro');
  await seedSucursal('pruebas', 'Sucursal Pruebas');
});

// Los tres usuarios que la demo tiene de fábrica.
async function seedDeFabrica() {
  const main = await uno(
    `INSERT INTO usuarios (nombre, password, rol, sucursal, activo)
     VALUES ('Dueña', 'x', 'admin_main', NULL, TRUE) RETURNING id`
  );
  const admin = await uno(
    `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, activo, es_prueba)
     VALUES ('Prueba', 'Admin', 'x', 'admin', 'pruebas', TRUE, TRUE) RETURNING id`
  );
  const operador = await uno(
    `INSERT INTO usuarios (nombre, apellido, password, rol, sucursal, activo, es_prueba)
     VALUES ('Prueba', 'Empleado', 'x', 'operador', 'pruebas', TRUE, TRUE) RETURNING id`
  );
  return { main: main.id, admin: admin.id, operador: operador.id };
}

// Un usuario dado de alta por un visitante, con toda la operación que lo
// retiene: es lo que hacía fallar el borrado.
async function seedVisitanteContaminando(sucursal = 'centro') {
  const u = await uno(
    `INSERT INTO usuarios (nombre, password, rol, sucursal, activo, es_prueba)
     VALUES ('Colado', 'x', 'operador', $1, TRUE, FALSE) RETURNING id`, [sucursal]
  );
  const cliente = await seedCliente({ sucursal });
  const producto = await seedProducto({ sucursal });
  await seedMaquina({ sucursal });

  // notas.usuario_id y notas.cliente_id son RESTRICT.
  const nota = await uno(
    `INSERT INTO notas (usuario_id, cliente_id, tipo_servicio, tipo_prenda, sucursal)
     VALUES ($1, $2, 'AUTOSERVICIO', 'ROPA', $3) RETURNING id`, [u.id, cliente, sucursal]
  );
  // cajas.usuario_apertura_id y movimientos_caja.usuario_id son RESTRICT.
  const caja = await uno(
    `INSERT INTO cajas (usuario_apertura_id, sucursal) VALUES ($1, $2) RETURNING id`, [u.id, sucursal]
  );
  await pool.query(
    `INSERT INTO movimientos_caja (caja_id, usuario_id, tipo, concepto, monto)
     VALUES ($1, $2, 'entrada', 'Fondo', 100)`, [caja.id, u.id]
  );
  // movimientos_insumos.usuario_id es RESTRICT.
  const insumo = await uno(
    `INSERT INTO insumos (nombre, unidad, sucursal) VALUES ('Jabón viejo', 'L', $1) RETURNING id`, [sucursal]
  );
  await pool.query(
    `INSERT INTO movimientos_insumos (insumo_id, usuario_id, tipo, cantidad, nota_id)
     VALUES ($1, $2, 'salida', 1, $3)`, [insumo.id, u.id, nota.id]
  );
  await pool.query(
    `INSERT INTO producto_movimientos (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, nota_id)
     VALUES ($1, $2, $3, 'venta', 'botellas', 1, $4)`, [producto, sucursal, u.id, nota.id]
  );
  await pool.query(`INSERT INTO checkins (usuario_id, fecha) VALUES ($1, CURRENT_DATE)`, [u.id]);
  await pool.query(
    `INSERT INTO notificaciones (tipo, mensaje, sucursal, usuario_id)
     VALUES ('ciclo', 'Terminó', $1, $2)`, [sucursal, u.id]
  );
  return u.id;
}

// Mismo orden que reset-demo.mjs, incluido el borrado de sucursales.
const SUCURSALES_BASE = ['lopez_cotilla', 'retiro', 'pruebas', 'centro'];

async function correrLimpieza() {
  await pool.query('BEGIN');
  try {
    await limpiarOperacion(pool);
    const borrados = await borrarUsuariosDeVisitantes(pool);
    await borrarCatalogos(pool);
    await pool.query('DELETE FROM sucursales WHERE slug <> ALL($1)', [SUCURSALES_BASE]);
    await pool.query('COMMIT');
    return borrados;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

describe('limpieza del reset de la demo', () => {
  it('borra al usuario de un visitante aunque tenga notas, caja e inventario a su nombre', async () => {
    const fabrica = await seedDeFabrica();
    await seedVisitanteContaminando('centro');

    await expect(correrLimpieza()).resolves.toBe(1);

    const quedan = (await pool.query('SELECT id FROM usuarios ORDER BY id')).rows.map((r) => r.id);
    expect(quedan).toEqual([fabrica.main, fabrica.admin, fabrica.operador]);
  });

  it('deja la operación y los catálogos a cero', async () => {
    await seedDeFabrica();
    await seedVisitanteContaminando('centro');
    await correrLimpieza();

    for (const t of ['notas', 'cajas', 'movimientos_caja', 'clientes', 'producto_movimientos',
                     'movimientos_insumos', 'notificaciones', 'checkins', 'productos', 'maquinas']) {
      expect({ [t]: await cuantos(t) }).toEqual({ [t]: 0 });
    }
  });

  it('conserva a los de fábrica aunque no haya nada que limpiar (es idempotente)', async () => {
    const fabrica = await seedDeFabrica();

    await expect(correrLimpieza()).resolves.toBe(0);
    await expect(correrLimpieza()).resolves.toBe(0);

    const quedan = (await pool.query('SELECT id FROM usuarios ORDER BY id')).rows.map((r) => r.id);
    expect(quedan).toEqual([fabrica.main, fabrica.admin, fabrica.operador]);
  });

  it('borra la sucursal que creó un visitante aunque le colgaran máquinas e inventario', async () => {
    await seedDeFabrica();
    await seedSucursal('inventada', 'La que puso un visitante');
    await seedProducto({ sucursal: 'inventada' });
    await seedMaquina({ sucursal: 'inventada' });
    await pool.query(
      `INSERT INTO insumos (nombre, unidad, sucursal) VALUES ('Cloro', 'L', 'inventada')`
    );

    await expect(correrLimpieza()).resolves.toBe(0);

    const slugs = (await pool.query('SELECT slug FROM sucursales ORDER BY slug')).rows.map((r) => r.slug);
    expect(slugs).not.toContain('inventada');
  });

  it('si un visitante duplicó los usuarios de prueba, solo sobreviven los originales', async () => {
    const fabrica = await seedDeFabrica();
    // Con ENTORNO_DEMO el alta nace con es_prueba = TRUE: no debe blindarla.
    await pool.query(
      `INSERT INTO usuarios (nombre, password, rol, sucursal, activo, es_prueba)
       VALUES ('Otro', 'x', 'admin', 'pruebas', TRUE, TRUE)`
    );

    await expect(correrLimpieza()).resolves.toBe(1);

    const quedan = (await pool.query('SELECT id FROM usuarios ORDER BY id')).rows.map((r) => r.id);
    expect(quedan).toEqual([fabrica.main, fabrica.admin, fabrica.operador]);
  });
});
