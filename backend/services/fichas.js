/**
 * Inventario de fichas por sucursal (mig. 176). Las máquinas "Trabaja con
 * fichas: sin Sonoff y sin tiempos" arrancan con fichas del negocio: al
 * iniciarlas salen de las disponibles y entran a la máquina; al recogerlas
 * vuelven. Todo deja su renglón en `fichas_movimientos`. Las funciones reciben
 * el `client` de la transacción de quien las llama.
 */
import { pideFichasSql, maxFichasSql } from '../db/sqlMaquina.js';

/** Tope de fichas por arranque; cada modelo puede pedir menos (`max_fichas`). */
export const MAX_FICHAS_POR_ARRANQUE = 3;

/** Error que el controlador devuelve tal cual (400). */
export class ErrorFichas extends Error {
  constructor(message, code = 'FICHAS') {
    super(message);
    this.code = code;
  }
}

/** Ids (de `ids`) que al iniciar piden fichas, con su máximo por arranque. */
export async function maquinasQuePidenFichas(client, ids) {
  if (!ids || ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT m.id, m.nombre, ${maxFichasSql('m')} AS max_fichas
       FROM maquinas m WHERE m.id = ANY($1::int[]) AND ${pideFichasSql('m')}`,
    [ids.map(Number)]
  );
  return rows;
}

/** Lee `fichas` del body: de 1 a `max` (el del modelo); si no, lanza ErrorFichas. */
export function leerFichas(valor, nombreMaquina, max = MAX_FICHAS_POR_ARRANQUE) {
  const n = Number(valor);
  const tope = Math.min(MAX_FICHAS_POR_ARRANQUE, Math.max(1, Number(max) || MAX_FICHAS_POR_ARRANQUE));
  if (!Number.isInteger(n) || n < 1 || n > tope) {
    const opciones = tope === 1 ? '1' : `de 1 a ${tope}`;
    throw new ErrorFichas(`Elige cuántas fichas se le meten a ${nombreMaquina}: ${opciones}.`, 'FICHAS_SIN_ELEGIR');
  }
  return n;
}

/**
 * Mete `fichas` a la máquina al arrancarla: salen de las disponibles de su
 * sucursal (pueden quedar en negativo), entran a la máquina y la pasada viva
 * de la nota las guarda. Devuelve las disponibles que quedan.
 */
export async function usarFichas(client, { maquinaId, notaId, fichas, usuarioId }) {
  const { rows: [maq] } = await client.query(
    `UPDATE maquinas SET fichas_dentro = fichas_dentro + $2 WHERE id = $1
     RETURNING id, nombre, sucursal`,
    [maquinaId, fichas]
  );
  const { rows: [suc] } = await client.query(
    `UPDATE sucursales SET fichas_disponibles = fichas_disponibles - $2 WHERE slug = $1
     RETURNING fichas_disponibles`,
    [maq.sucursal, fichas]
  );
  // La pasada de esta máquina en la nota que la arrancó (la más reciente sin cerrar).
  await client.query(
    `UPDATE nota_carga_maquinas SET fichas = COALESCE(fichas, 0) + $3
      WHERE id = (
        SELECT p.id FROM nota_carga_maquinas p
          JOIN nota_cargas nc ON nc.id = p.carga_id
         WHERE nc.nota_id = $1 AND p.maquina_id = $2 AND p.finalizada_at IS NULL
         ORDER BY p.asignada_at DESC, p.id DESC LIMIT 1
      )`,
    [notaId, maquinaId, fichas]
  );
  await client.query(
    `INSERT INTO fichas_movimientos
       (sucursal, tipo, cantidad, disponibles_despues, maquina_id, maquina_nombre, nota_id, usuario_id)
     VALUES ($1, 'uso', $2, $3, $4, $5, $6, $7)`,
    [maq.sucursal, -fichas, suc.fichas_disponibles, maq.id, maq.nombre, notaId, usuarioId ?? null]
  );
  return suc.fichas_disponibles;
}

/**
 * Arranque con fichas: si alguna de `ids` las pide, tiene que ser la única y
 * traer `fichas`. Devuelve [{ maquinaId, fichas }] por meter después de arrancar.
 */
export async function fichasDelArranque(client, ids, fichasBody) {
  const piden = await maquinasQuePidenFichas(client, ids);
  if (piden.length === 0) return [];
  if (ids.length > 1) {
    throw new ErrorFichas(`Inicia ${piden[0].nombre} sola: hay que decir cuántas fichas lleva.`, 'FICHAS_SIN_ELEGIR');
  }
  return [{ maquinaId: piden[0].id, fichas: leerFichas(fichasBody, piden[0].nombre, piden[0].max_fichas) }];
}

/** Recoge las fichas de una máquina (o de todas las de la sucursal) a las disponibles. */
export async function recogerFichas(client, { sucursal, maquinaId = null, usuarioId }) {
  const { rows: maquinas } = await client.query(
    `SELECT id, nombre, fichas_dentro FROM maquinas
      WHERE sucursal = $1 AND fichas_dentro > 0 AND ($2::int IS NULL OR id = $2)
      ORDER BY nombre FOR UPDATE`,
    [sucursal, maquinaId]
  );
  let recogidas = 0;
  for (const m of maquinas) {
    await client.query('UPDATE maquinas SET fichas_dentro = 0 WHERE id = $1', [m.id]);
    const { rows: [suc] } = await client.query(
      `UPDATE sucursales SET fichas_disponibles = fichas_disponibles + $2 WHERE slug = $1
       RETURNING fichas_disponibles`,
      [sucursal, m.fichas_dentro]
    );
    await client.query(
      `INSERT INTO fichas_movimientos
         (sucursal, tipo, cantidad, disponibles_despues, maquina_id, maquina_nombre, usuario_id)
       VALUES ($1, 'recoger', $2, $3, $4, $5, $6)`,
      [sucursal, m.fichas_dentro, suc.fichas_disponibles, m.id, m.nombre, usuarioId ?? null]
    );
    recogidas += m.fichas_dentro;
  }
  return recogidas;
}

/** Fija las disponibles de la sucursal (corrige el conteo) y deja la diferencia en el historial. */
export async function ajustarFichas(client, { sucursal, disponibles, usuarioId }) {
  const { rows: [antes] } = await client.query(
    'SELECT fichas_disponibles FROM sucursales WHERE slug = $1 FOR UPDATE', [sucursal]
  );
  const diferencia = disponibles - antes.fichas_disponibles;
  if (diferencia === 0) return 0;
  await client.query('UPDATE sucursales SET fichas_disponibles = $2 WHERE slug = $1', [sucursal, disponibles]);
  await client.query(
    `INSERT INTO fichas_movimientos (sucursal, tipo, cantidad, disponibles_despues, usuario_id)
     VALUES ($1, 'ajuste', $2, $3, $4)`,
    [sucursal, diferencia, disponibles, usuarioId ?? null]
  );
  return diferencia;
}
