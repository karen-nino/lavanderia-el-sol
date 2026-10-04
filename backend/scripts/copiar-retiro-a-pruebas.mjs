// Copia a la sucursal oculta `pruebas` el inventario y las máquinas de Retiro
// (2026-10-04, a pedido), para que el entorno de pruebas sea igual al real.
//
//   node scripts/copiar-retiro-a-pruebas.mjs            → solo dice qué haría
//   node scripts/copiar-retiro-a-pruebas.mjs --aplicar  → lo hace
//
// En producción: fly ssh console -a lavanderia-el-sol-api -C "node scripts/copiar-retiro-a-pruebas.mjs"
//
// · Productos: los no archivados de Retiro, con su stock (el reservado en 0).
//   Si `pruebas` ya tiene productos vivos no copia ninguno, para no duplicar.
// · Máquinas: borra las de `pruebas` y copia las de Retiro (nombre, tipo,
//   tamaño, marca, modelo, serie, notas, capacidad y estado). NUNCA copia el
//   enlace al Sonoff (`device_id`, `device_canal`): encender una máquina de
//   pruebas encendería la real. Si alguna máquina de `pruebas` tiene historial
//   (notas o avisos), no toca ninguna.
// Todo en una transacción: o queda completo o no queda nada.
import pool from '../db/pool.js';

const APLICAR = process.argv.includes('--aplicar');
const ORIGEN = 'retiro';
const DESTINO = 'pruebas';

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // ── Productos ──
  const { rows: [{ n: vivos }] } = await client.query(
    'SELECT count(*)::int AS n FROM productos WHERE sucursal = $1 AND NOT archivado', [DESTINO]
  );
  let productos = [];
  if (vivos > 0) {
    console.log(`Productos: ${DESTINO} ya tiene ${vivos} productos vivos; no se copia ninguno.`);
  } else {
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'productos' AND is_generated = 'NEVER'
          AND column_name NOT IN ('id', 'created_at', 'updated_at', 'sucursal', 'stock_reservado')
        ORDER BY ordinal_position`
    );
    const lista = cols.map(c => c.column_name).join(', ');
    ({ rows: productos } = await client.query(
      `INSERT INTO productos (${lista}, sucursal, stock_reservado)
       SELECT ${lista}, $2, 0 FROM productos WHERE sucursal = $1 AND NOT archivado ORDER BY id
       RETURNING nombre, marca, tamano_bolsa, stock_actual, stock_granel_medidas`,
      [ORIGEN, DESTINO]
    ));
    console.log(`Productos copiados: ${productos.length}`);
    console.table(productos);
  }

  // ── Máquinas ──
  const { rows: conHistorial } = await client.query(
    `SELECT m.nombre FROM maquinas m
      WHERE m.sucursal = $1
        AND (EXISTS (SELECT 1 FROM nota_cargas nc
                      WHERE m.id IN (nc.lavadora_id, nc.secadora_id, nc.lavadora_usada_id, nc.secadora_usada_id))
          OR EXISTS (SELECT 1 FROM nota_carga_maquinas ncm WHERE ncm.maquina_id = m.id)
          OR EXISTS (SELECT 1 FROM notificaciones nt WHERE nt.maquina_id = m.id))`,
    [DESTINO]
  );
  if (conHistorial.length > 0) {
    console.log(`Máquinas: no se tocan; con historial en ${DESTINO}: ${conHistorial.map(r => r.nombre).join(', ')}`);
  } else {
    const { rows: borradas } = await client.query(
      'DELETE FROM maquinas WHERE sucursal = $1 RETURNING nombre', [DESTINO]
    );
    const { rows: copiadas } = await client.query(
      `INSERT INTO maquinas (nombre, tipo, estado, modelo, numero_serie, fecha_adquisicion, notas,
                             capacidad, tamano, marca, sucursal)
       SELECT nombre, tipo, CASE WHEN estado = 'en_uso' THEN 'disponible' ELSE estado END,
              modelo, numero_serie, fecha_adquisicion, notas, capacidad, tamano, marca, $2
         FROM maquinas WHERE sucursal = $1 ORDER BY id
       RETURNING nombre, tipo, tamano, marca, modelo, estado, device_id`,
      [ORIGEN, DESTINO]
    );
    console.log(`Máquinas borradas de ${DESTINO}: ${borradas.map(r => r.nombre).join(', ') || 'ninguna'}`);
    console.log(`Máquinas copiadas: ${copiadas.length}`);
    console.table(copiadas);
  }

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('HECHO: cambios guardados.');
  } else {
    await client.query('ROLLBACK');
    console.log('Simulación: no se guardó nada. Para aplicarlo, agrega --aplicar.');
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Falló; no se guardó nada:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
