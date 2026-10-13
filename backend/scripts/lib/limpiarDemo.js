// Borrado de la operación de la demo en el orden que exigen las claves
// foráneas; aparte de reset-demo.mjs para que las pruebas usen la misma
// secuencia. Recibe algo con .query() dentro de una transacción ya abierta.

/**
 * Borra toda la operación, sin filtrar por sucursal (una fila que quedara
 * bloquearía el borrado de usuarios por RESTRICT). Orden: lo que apunta a las
 * notas, las notas (con su cascada), y luego cajas y clientes.
 */
const OPERACION = [
  'producto_movimientos',
  'movimientos_insumos',
  'notas',
  'cajas',
  'clientes',
  'notificaciones',
  'checkins',
];

export async function limpiarOperacion(db) {
  for (const tabla of OPERACION) await db.query(`DELETE FROM ${tabla}`);
}

/**
 * Borra los usuarios que no son de fábrica (admin_main y los dos de prueba).
 * Llamar después de limpiarOperacion().
 */
export async function borrarUsuariosDeVisitantes(db) {
  const { rowCount } = await db.query(
    `DELETE FROM usuarios
      WHERE rol <> 'admin_main'
        AND id NOT IN (
          SELECT DISTINCT ON (rol) id FROM usuarios
           WHERE es_prueba = TRUE AND rol IN ('admin', 'operador')
           ORDER BY rol, id
        )`
  );
  return rowCount;
}

/**
 * Borra productos, máquinas e insumos para que seed_pruebas.js los recree de
 * fábrica (el seeder respeta lo que encuentra). Llamar antes de borrar
 * sucursales, que no tienen ON DELETE hacia ellos.
 */
export async function borrarCatalogos(db) {
  await db.query('DELETE FROM productos');
  await db.query('DELETE FROM maquinas');
  await db.query('DELETE FROM insumos');
}
