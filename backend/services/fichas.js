/**
 * Inventario de fichas por sucursal (mig. 176). Las máquinas "Trabaja con
 * fichas: sin Sonoff y sin tiempos" arrancan con fichas del negocio: al
 * iniciarlas salen de las disponibles y entran a la máquina; al recogerlas
 * vuelven. Todo deja su renglón en `fichas_movimientos`. Las funciones reciben
 * el `client` de la transacción de quien las llama. Desde la mig. 179 cada
 * máquina usa las de su tipo (`ficha_tipo_id`); sin tipo, las generales de la
 * sucursal.
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

/**
 * Lee `fichas` del body: de 1 a `max` (el del modelo); si no, lanza ErrorFichas.
 * Con máximo 1 no se pregunta: sin dato, lleva 1.
 */
export function leerFichas(valor, nombreMaquina, max = MAX_FICHAS_POR_ARRANQUE) {
  const tope = Math.min(MAX_FICHAS_POR_ARRANQUE, Math.max(1, Number(max) || MAX_FICHAS_POR_ARRANQUE));
  const n = tope === 1 && (valor === undefined || valor === null) ? 1 : Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > tope) {
    const opciones = tope === 1 ? '1' : `de 1 a ${tope}`;
    throw new ErrorFichas(`Elige cuántas fichas se le meten a ${nombreMaquina}: ${opciones}.`, 'FICHAS_SIN_ELEGIR');
  }
  return n;
}

/**
 * Suma `cantidad` (negativa = salen) a las disponibles de un tipo de ficha, o
 * a las generales de la sucursal si no hay tipo. Devuelve las que quedan.
 */
async function moverDisponibles(client, { sucursal, fichaTipoId, cantidad }) {
  const { rows: [fila] } = fichaTipoId
    ? await client.query(
      'UPDATE fichas_tipos SET disponibles = disponibles + $2 WHERE id = $1 RETURNING disponibles',
      [fichaTipoId, cantidad]
    )
    : await client.query(
      `UPDATE sucursales SET fichas_disponibles = fichas_disponibles + $2 WHERE slug = $1
       RETURNING fichas_disponibles AS disponibles`,
      [sucursal, cantidad]
    );
  return fila.disponibles;
}

/** Renglón del historial; el nombre del tipo se guarda por si después se quita. */
async function registrarMovimiento(client, { sucursal, tipo, cantidad, disponiblesDespues, fichaTipoId = null,
  maquinaId = null, maquinaNombre = null, notaId = null, usuarioId = null }) {
  await client.query(
    `INSERT INTO fichas_movimientos
       (sucursal, tipo, cantidad, disponibles_despues, maquina_id, maquina_nombre, nota_id, usuario_id,
        ficha_tipo_id, ficha_tipo_nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT nombre FROM fichas_tipos WHERE id = $9))`,
    [sucursal, tipo, cantidad, disponiblesDespues, maquinaId, maquinaNombre, notaId, usuarioId, fichaTipoId]
  );
}

/**
 * Mete `fichas` a la máquina al arrancarla: salen de las disponibles de su
 * tipo (pueden quedar en negativo), entran a la máquina y la pasada viva de la
 * nota las guarda. Devuelve las disponibles que quedan de ese tipo.
 */
export async function usarFichas(client, { maquinaId, notaId, fichas, usuarioId }) {
  const { rows: [maq] } = await client.query(
    `UPDATE maquinas SET fichas_dentro = fichas_dentro + $2 WHERE id = $1
     RETURNING id, nombre, sucursal, ficha_tipo_id`,
    [maquinaId, fichas]
  );
  const quedan = await moverDisponibles(client, { sucursal: maq.sucursal, fichaTipoId: maq.ficha_tipo_id, cantidad: -fichas });
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
  await registrarMovimiento(client, {
    sucursal: maq.sucursal, tipo: 'uso', cantidad: -fichas, disponiblesDespues: quedan, fichaTipoId: maq.ficha_tipo_id,
    maquinaId: maq.id, maquinaNombre: maq.nombre, notaId, usuarioId,
  });
  return quedan;
}

/**
 * Cobra las fichas de más de un arranque: la primera va en el precio de la
 * carga y cada una de más cuesta lo mismo (congelado en `precio_fichas_extra`).
 * Solo Autoservicio; en Por Encargo el servicio ya lo incluye. Devuelve lo que
 * sumó; quien llama recalcula el total de la nota.
 */
export async function cobrarFichasDeMas(client, { notaId, maquinaId, fichas }) {
  const deMas = Number(fichas) - 1;
  if (!(deMas > 0)) return 0;
  /* La carga de la pasada viva de esa máquina en la nota (como usarFichas). */
  const { rows: [carga] } = await client.query(
    `SELECT nc.id,
            CASE WHEN p.slot = 'lavadora' THEN nc.precio_lavadora ELSE nc.precio_secadora END AS precio
       FROM nota_carga_maquinas p
       JOIN nota_cargas nc ON nc.id = p.carga_id
       JOIN notas n ON n.id = nc.nota_id
      WHERE nc.nota_id = $1 AND p.maquina_id = $2 AND p.finalizada_at IS NULL
        AND n.tipo_servicio = 'AUTOSERVICIO'
      ORDER BY p.asignada_at DESC, p.id DESC LIMIT 1`,
    [notaId, maquinaId]
  );
  const monto = carga ? deMas * Number(carga.precio) : 0;
  if (!(monto > 0)) return 0;
  await client.query(
    `UPDATE nota_cargas
        SET fichas_extra = fichas_extra + $2, precio_fichas_extra = precio_fichas_extra + $3
      WHERE id = $1`,
    [carga.id, deMas, monto]
  );
  return monto;
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

/** Recoge las fichas de una máquina (o de todas las de la sucursal) a las disponibles de su tipo. */
export async function recogerFichas(client, { sucursal, maquinaId = null, usuarioId }) {
  const { rows: maquinas } = await client.query(
    `SELECT id, nombre, fichas_dentro, ficha_tipo_id FROM maquinas
      WHERE sucursal = $1 AND fichas_dentro > 0 AND ($2::int IS NULL OR id = $2)
      ORDER BY nombre FOR UPDATE`,
    [sucursal, maquinaId]
  );
  let recogidas = 0;
  for (const m of maquinas) {
    await client.query('UPDATE maquinas SET fichas_dentro = 0 WHERE id = $1', [m.id]);
    const quedan = await moverDisponibles(client, { sucursal, fichaTipoId: m.ficha_tipo_id, cantidad: m.fichas_dentro });
    await registrarMovimiento(client, {
      sucursal, tipo: 'recoger', cantidad: m.fichas_dentro, disponiblesDespues: quedan, fichaTipoId: m.ficha_tipo_id,
      maquinaId: m.id, maquinaNombre: m.nombre, usuarioId,
    });
    recogidas += m.fichas_dentro;
  }
  return recogidas;
}

/**
 * Fija las disponibles de un tipo de ficha (o las generales de la sucursal sin
 * `fichaTipoId`) y deja la diferencia en el historial.
 */
export async function ajustarFichas(client, { sucursal, disponibles, usuarioId, fichaTipoId = null }) {
  const { rows: [antes] } = fichaTipoId
    ? await client.query('SELECT disponibles FROM fichas_tipos WHERE id = $1 FOR UPDATE', [fichaTipoId])
    : await client.query(
      'SELECT fichas_disponibles AS disponibles FROM sucursales WHERE slug = $1 FOR UPDATE', [sucursal]
    );
  const diferencia = disponibles - antes.disponibles;
  if (diferencia === 0) return 0;
  await moverDisponibles(client, { sucursal, fichaTipoId, cantidad: diferencia });
  await registrarMovimiento(client, {
    sucursal, tipo: 'ajuste', cantidad: diferencia, disponiblesDespues: disponibles, fichaTipoId, usuarioId,
  });
  return diferencia;
}
