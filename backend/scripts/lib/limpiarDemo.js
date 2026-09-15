// Borrado de la operación de la base de la DEMO, en el orden que exigen las
// claves foráneas. Vive aparte de reset-demo.mjs para que las pruebas de
// integración puedan ejecutar exactamente la misma secuencia: es la parte
// frágil del reset, y si el orden se rompe la demo se queda sin restaurar.
//
// Recibe cualquier cosa con .query() —el pg.Client del script o el pool de las
// pruebas— y espera estar dentro de una transacción abierta por quien llama.

// El porqué de no filtrar por sucursal: en la base de la demo nada de esto es
// legítimo fuera de "pruebas", y filtrando se quedaban filas colgando que luego
// bloqueaban el borrado de usuarios. notas, cajas, movimientos_caja y
// movimientos_insumos apuntan a usuarios con ON DELETE RESTRICT, así que una
// sola fila huérfana tumbaba la transacción entera.
//
// El orden: primero lo que apunta a las notas, luego las notas (que arrastran
// en cascada sus cargas, productos e historiales), después las cajas y los
// clientes, a los que las notas retenían con RESTRICT.
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

// Usuarios de fábrica: el admin_main (dueño de la base) y los dos que crea
// seed_pruebas.js, que los localiza como el es_prueba más antiguo de cada rol.
// Cualquier otro lo dio de alta un visitante y se va. Llamar DESPUÉS de
// limpiarOperacion(): todo lo que los retenía con RESTRICT ya no existe.
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

// Inventario y máquinas: se borran para que seed_pruebas.js los vuelva a crear
// con sus valores de fábrica. Reutilizar los que ya están no sirve —el seeder
// respeta lo que encuentra y solo repone el granel—, así que un visitante que
// dejara las bolsas en cero las dejaba en cero para siempre. Sus referencias ya
// cayeron con las notas y los movimientos.
//
// Los insumos entran aquí aunque seed_pruebas no los cree: son del módulo
// viejo, en la demo no hay ninguno de fábrica, y cuelgan de una sucursal igual
// que los demás. Llamar ANTES de borrar sucursales: productos, máquinas e
// insumos apuntan a sucursales sin ON DELETE, así que una sucursal que un
// visitante creara y llenara no se podría borrar con ellos dentro.
export async function borrarCatalogos(db) {
  await db.query('DELETE FROM productos');
  await db.query('DELETE FROM maquinas');
  await db.query('DELETE FROM insumos');
}
