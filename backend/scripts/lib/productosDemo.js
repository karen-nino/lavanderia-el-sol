// Productos de marca de la demo pública (se venden por unidad). Solo lo usa
// reset-demo.mjs, antes de seed_pruebas.js.

export const PRODUCTOS_MARCA_DEMO = [
  { nombre: 'Detergente',   marca: 'Ariel',     precio: 32 },
  { nombre: 'Detergente',   marca: 'Persil',    precio: 35 },
  { nombre: 'Detergente',   marca: 'Más Color', precio: 30 },
  { nombre: 'Suavizante',   marca: 'Downy',     precio: 30 },
  { nombre: 'Suavizante',   marca: 'Suavitel',  precio: 26 },
  { nombre: 'Blanqueador',  marca: 'Cloralex',  precio: 18 },
  { nombre: 'Quitamanchas', marca: 'Vanish',    precio: 28 },
];

/** Marcas del catálogo de Ajustes → Inventario (incluye Ensueño, de seed_pruebas.js). */
export const MARCAS_DEMO = [...new Set([...PRODUCTOS_MARCA_DEMO.map((p) => p.marca), 'Ensueño'])];

/** Nombres del catálogo de marcas que no son marcas; se quitan si nadie los usa. */
export const NO_MARCAS_DEMO = ['Detergente', 'Suavizante', 'Blanqueador', 'Otro'];

/** Idempotente: cada marca y producto solo se crean si faltan. */
export async function sembrarProductosMarcaDemo(db, sucursal) {
  await db.query(
    `DELETE FROM marcas_producto mp
      WHERE mp.nombre = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM productos p WHERE lower(p.marca) = lower(mp.nombre))`,
    [NO_MARCAS_DEMO]
  );

  for (const marca of MARCAS_DEMO) {
    const { rowCount } = await db.query('SELECT 1 FROM marcas_producto WHERE lower(nombre) = lower($1)', [marca]);
    if (rowCount === 0) await db.query('INSERT INTO marcas_producto (nombre) VALUES ($1)', [marca]);
  }

  let creados = 0;
  for (const p of PRODUCTOS_MARCA_DEMO) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM productos
        WHERE sucursal = $1 AND nombre = $2 AND marca = $3 AND tipo_liquido = 'marca' AND archivado = FALSE`,
      [sucursal, p.nombre, p.marca]
    );
    if (rowCount > 0) continue;
    await db.query(
      `INSERT INTO productos
         (nombre, clase, unidad, marca, es_por_medida, tipo_liquido, medidas_por_envase,
          botella_ml, medida_ml, precio_botella, stock_actual, stock_minimo, sucursal)
       VALUES ($1, 'liquido', 'Medidas', $2, TRUE, 'marca', 1, 1, 1, $3, 24, 6, $4)`,
      [p.nombre, p.marca, p.precio, sucursal]
    );
    creados += 1;
  }
  return creados;
}
