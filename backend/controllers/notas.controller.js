import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
// Estados con los que puede nacer una nota.
const ESTADOS_INICIALES   = ['EN_ESPERA', 'LAVANDO', 'SECANDO'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande', 'jumbo'];
const TIPOS_PRENDA_VALIDOS = ['ROPA', 'EDREDON'];
const TIEMPOS_ENTREGA_VALIDOS = ['MANANA', 'TARDE', 'NOCHE'];

// Transiciones permitidas por estado actual
const TRANSICIONES_VALIDAS = {
  EN_ESPERA:  ['LAVANDO', 'SECANDO',          'CANCELADA'],
  LAVANDO:    ['SECANDO', 'LISTA',            'CANCELADA'],
  SECANDO:    ['LISTA',                       'CANCELADA'],
  LISTA:      ['PAGADA',  'FINALIZADA',       'CANCELADA'],
  PAGADA:     ['FINALIZADA',                  'CANCELADA'],
  FINALIZADA: [],
  CANCELADA:  [],
};

// Subconsulta con los IDs de todas las máquinas vinculadas a la nota `n`:
// las de sus cargas (autoservicio, tabla nota_cargas) más las columnas
// legadas maquina_id / secadora_id (Por Encargo y notas viejas).
const SQL_MAQUINAS_DE_NOTA = `
  SELECT nc.lavadora_id AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT nc.secadora_id FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT n.maquina_id
  UNION SELECT n.secadora_id`;

// Fase de proceso de una nota según las máquinas EN USO ahora mismo: LAVANDO si
// alguna lavadora corre; si no, SECANDO si alguna secadora corre; y EN_ESPERA si
// no hay ninguna máquina en uso (todas asignadas pero sin iniciar, o ya
// detenidas). (terminar-lavado desvincula la lavadora al pasar a la secadora,
// así que una lavadora vinculada y en uso implica lavado en curso.)
async function faseProcesoDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.lavadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
       ) OR EXISTS (
         SELECT 1 FROM maquinas m JOIN notas n ON n.maquina_id = m.id
          WHERE n.id = $1 AND m.estado = 'en_uso' AND m.tipo <> 'secadora'
       ) AS lavando,
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
       ) OR EXISTS (
         SELECT 1 FROM maquinas m JOIN notas n ON n.secadora_id = m.id
          WHERE n.id = $1 AND m.estado = 'en_uso' AND m.tipo = 'secadora'
       ) AS secando`,
    [notaId]
  );
  if (rows[0].lavando) return 'LAVANDO';
  if (rows[0].secando) return 'SECANDO';
  return 'EN_ESPERA';
}

// IDs (sin repetir) de todas las máquinas vinculadas a una nota.
async function maquinasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT DISTINCT x.mid
       FROM notas n, LATERAL (${SQL_MAQUINAS_DE_NOTA}) x
      WHERE n.id = $1 AND x.mid IS NOT NULL`,
    [notaId]
  );
  return rows.map(r => r.mid);
}

// Libera (pasa a disponible) las máquinas de la nota que sigan en uso.
// Idempotente: las que ya están disponibles o en mantenimiento no se tocan.
async function liberarMaquinasDeNota(client, notaId) {
  const ids = await maquinasDeNota(client, notaId);
  if (ids.length === 0) return;
  await client.query(
    `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
      WHERE id = ANY($1) AND estado = 'en_uso'`,
    [ids]
  );
}

// Recalcula precio_total de una nota con la fórmula completa:
//   cargas (suma de nota_cargas si existen; si no, la fórmula legada
//   cantidad_cargas × precio_base) + productos + ajuste.
async function recalcularPrecioTotal(client, notaId) {
  // El ajuste por carga (nota_cargas.ajuste) es para Por Encargo; el ajuste a
  // nivel nota (notas.ajuste) es para Autoservicio. Solo uno está en uso a la
  // vez (el otro es 0), así que sumar ambos es correcto en los dos casos.
  const { rows } = await client.query(
    `UPDATE notas n
        SET precio_total =
          COALESCE(
            (SELECT SUM(nc.precio_lavadora + nc.precio_secadora + nc.ajuste)
               FROM nota_cargas nc WHERE nc.nota_id = n.id),
            n.cantidad_cargas * COALESCE(n.precio_base, 0)
              + COALESCE(n.cantidad_cargas_secadora, 0) * COALESCE(n.precio_base_secadora, 0)
          )
          + COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                        FROM nota_productos np WHERE np.nota_id = n.id), 0)
          + n.ajuste
      WHERE n.id = $1
      RETURNING precio_total`,
    [notaId]
  );
  return rows[0]?.precio_total ?? null;
}

// Tarifas por carga desde ajustes (con los defaults de siempre).
async function tarifasCarga(client) {
  const { rows } = await client.query(
    `SELECT precio_carga_mediana, precio_carga_jumbo,
            precio_carga_secadora, precio_secadora_jumbo, precio_secadora_edredon,
            precio_edredon_jumbo
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  return {
    mediana:         c.precio_carga_mediana    != null ? Number(c.precio_carga_mediana)    : 70,
    jumbo:           c.precio_carga_jumbo      != null ? Number(c.precio_carga_jumbo)      : 70,
    // Secado por categoría. La columna plana precio_carga_secadora es la Mediana.
    secadora:        c.precio_carga_secadora   != null ? Number(c.precio_carga_secadora)   : 45,
    secadoraJumbo:   c.precio_secadora_jumbo   != null ? Number(c.precio_secadora_jumbo)   : 45,
    secadoraEdredon: c.precio_secadora_edredon != null ? Number(c.precio_secadora_edredon) : 45,
    edredonJumbo:    c.precio_edredon_jumbo    != null ? Number(c.precio_edredon_jumbo)    : 80,
  };
}

// Tiempos de ciclo (minutos). El secado también por categoría (Mediana =
// columna plana tiempo_carga_secadora). El lavado edredón usa el ciclo jumbo.
async function tiemposCarga(client) {
  const { rows } = await client.query(
    `SELECT tiempo_carga_mediana, tiempo_carga_jumbo, tiempo_edredon_jumbo,
            tiempo_carga_secadora, tiempo_secadora_jumbo, tiempo_secadora_edredon
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  return {
    mediana:         c.tiempo_carga_mediana    != null ? Number(c.tiempo_carga_mediana)    : 30,
    jumbo:           c.tiempo_carga_jumbo      != null ? Number(c.tiempo_carga_jumbo)      : 45,
    // Lavado de edredón (en lavadora jumbo); si no está, cae al tiempo del jumbo.
    edredonLavado:   c.tiempo_edredon_jumbo    != null ? Number(c.tiempo_edredon_jumbo)
                     : (c.tiempo_carga_jumbo   != null ? Number(c.tiempo_carga_jumbo) : 45),
    secMediana:      c.tiempo_carga_secadora   != null ? Number(c.tiempo_carga_secadora)   : 30,
    secJumbo:        c.tiempo_secadora_jumbo   != null ? Number(c.tiempo_secadora_jumbo)   : 30,
    secEdredon:      c.tiempo_secadora_edredon != null ? Number(c.tiempo_secadora_edredon) : 30,
  };
}

function tarifaLavadora(tipoMaquina, tipoPrenda, t) {
  if (tipoMaquina === 'lavadora_jumbo') {
    return String(tipoPrenda).toUpperCase() === 'EDREDON' ? t.edredonJumbo : t.jumbo;
  }
  return t.mediana;
}

// Categoría de secado según el TAMAÑO de la secadora: prenda edredón → edredón;
// secadora jumbo → jumbo; resto (incl. secadora sin tamaño) → mediana.
// Devuelve 'mediana' | 'jumbo' | 'edredon'.
function categoriaSecado(secadoraTamano, tipoPrenda) {
  if (String(tipoPrenda).toUpperCase() === 'EDREDON') return 'edredon';
  if (secadoraTamano === 'jumbo') return 'jumbo';
  return 'mediana';
}

// Tarifa de secado según el tamaño de la secadora (Ajustes → Máquinas):
// mediana = precio_carga_secadora, jumbo = precio_secadora_jumbo, edredón =
// precio_secadora_edredon.
function tarifaSecadora(secadoraTamano, tipoPrenda, t) {
  const cat = categoriaSecado(secadoraTamano, tipoPrenda);
  if (cat === 'edredon') return t.secadoraEdredon;
  if (cat === 'jumbo')   return t.secadoraJumbo;
  return t.secadora; // mediana
}

// Sella maquinas.ciclo_minutos de TODAS las máquinas EN USO de la nota
// (lavadoras y secadoras) según la categoría de su carga. Necesario porque
// una misma máquina física (lavadora jumbo o cualquier secadora) puede tener
// distinta duración según lo que procesa: edredón vs. ropa jumbo vs. mediana.
//   Lavadora: prenda edredón (en jumbo) → edredonLavado; jumbo → jumbo; resto → mediana.
//   Secadora: prenda edredón → secEdredon; secadora jumbo → secJumbo; resto → secMediana.
// Idempotente; se llama tras poner máquinas en uso en cualquier flujo.
async function sellarCicloMaquinas(client, notaId) {
  const ti = await tiemposCarga(client);
  await client.query(
    `UPDATE maquinas m
        SET ciclo_minutos = ciclos.minutos
       FROM (
         -- Lavadoras de la nota
         SELECT nc.lavadora_id AS mid,
                CASE
                  WHEN UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' THEN $2::int
                  WHEN ml.tipo = 'lavadora_jumbo' THEN $3::int
                  ELSE $4::int
                END AS minutos
           FROM nota_cargas nc
           JOIN maquinas ml ON ml.id = nc.lavadora_id
          WHERE nc.nota_id = $1 AND nc.lavadora_id IS NOT NULL
         UNION ALL
         -- Secadoras de la nota: por el TAMAÑO de la secadora (prenda edredón manda).
         SELECT nc.secadora_id AS mid,
                CASE
                  WHEN UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' THEN $5::int
                  WHEN ms.tamano = 'jumbo' THEN $6::int
                  ELSE $7::int
                END AS minutos
           FROM nota_cargas nc
           JOIN maquinas ms ON ms.id = nc.secadora_id
          WHERE nc.nota_id = $1 AND nc.secadora_id IS NOT NULL
       ) ciclos
      WHERE m.id = ciclos.mid AND m.estado = 'en_uso'`,
    [notaId, ti.edredonLavado, ti.jumbo, ti.mediana, ti.secEdredon, ti.secJumbo, ti.secMediana]
  );
}

// Tope de precio por tamaño de carga (Ajustes): ninguna carga con tamaño
// puede rebasar su tope sumando lavadora + secadora + productos. El ajuste
// manual va aparte por decisión del negocio y NO cuenta contra el tope.
// Es tope duro para todos los roles (incluido admin); NULL en Ajustes =
// sin tope. Aplica SOLO a Servicio por Encargo (modalidad POR_ENCARGO): el
// Autoservicio no captura tamaño y queda fuera; el filtro por modalidad lo
// hace explícito además del tamaño. Se llama antes del COMMIT en cada ruta
// que pueda encarecer una carga (crear, editar, activar, asignar secadora).
// Devuelve el mensaje de error o null si todas las cargas caben.
async function validarTopesCargas(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.orden, nc.tamano,
            UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' AS es_edredon,
            nc.precio_lavadora + nc.precio_secadora AS maquinas,
            COALESCE(SUM(np.cantidad * np.precio_unitario), 0) AS productos,
            -- Prenda edredón: tope dedicado, por encima del de su tamaño.
            CASE
              WHEN UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' THEN a.tope_carga_edredon
              WHEN nc.tamano = 'chico'  THEN a.tope_carga_chico
              WHEN nc.tamano = 'grande' THEN a.tope_carga_grande
              WHEN nc.tamano = 'jumbo'  THEN a.tope_carga_jumbo
            END AS tope
       FROM nota_cargas nc
       JOIN notas n ON n.id = nc.nota_id
       CROSS JOIN ajustes a
       LEFT JOIN nota_productos np ON np.carga_id = nc.id
      WHERE nc.nota_id = $1 AND n.modalidad = 'POR_ENCARGO'
        AND (nc.tamano IS NOT NULL OR UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON')
        AND a.id = 1
      GROUP BY nc.id, a.tope_carga_chico, a.tope_carga_grande, a.tope_carga_jumbo, a.tope_carga_edredon
      ORDER BY nc.orden`,
    [notaId]
  );
  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  for (const r of rows) {
    if (r.tope == null) continue;
    const total = Number(r.maquinas) + Number(r.productos);
    if (total > Number(r.tope) + 1e-9) {
      const etiqueta = r.es_edredon ? 'edredón' : r.tamano;
      return `La carga ${r.orden} (${etiqueta}) rebasa el tope de ${fmt(r.tope)}: ` +
             `máquinas ${fmt(r.maquinas)} + productos ${fmt(r.productos)} = ${fmt(total)}. ` +
             `Quita ${fmt(total - Number(r.tope))} en productos para continuar.`;
    }
  }
  return null;
}

// Reserva un producto para una nota (o una carga): valida stock disponible,
// inserta la fila en nota_productos y aumenta stock_reservado. Lanza Error con
// el mensaje para el cliente si el producto no existe o no hay stock.
async function reservarProducto(client, notaId, cargaId, productoId, cantidad, sucursal) {
  const { rows: artRows } = await client.query(
    'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
    [productoId, sucursal]
  );
  if (artRows.length === 0) {
    throw new Error(`Producto ${productoId} no encontrado.`);
  }
  const art = artRows[0];
  const disponible = Number(art.stock_actual) - Number(art.stock_reservado);
  if (disponible < Number(cantidad)) {
    throw new Error(`Stock insuficiente para "${art.nombre}". Disponible: ${disponible}, solicitado: ${cantidad}.`);
  }
  const { rows: npRows } = await client.query(
    `INSERT INTO nota_productos (nota_id, carga_id, producto_id, cantidad, precio_unitario)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [notaId, cargaId, productoId, cantidad, art.precio_unitario ?? 0]
  );
  await client.query(
    'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
    [cantidad, productoId]
  );
  return { ...npRows[0], nombre: art.nombre, subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario) };
}

// Libera el stock reservado de los productos de una nota y los elimina.
async function liberarProductosDeNota(client, notaId) {
  await client.query(
    `UPDATE productos a
        SET stock_reservado = stock_reservado - np.cantidad
      FROM nota_productos np
      WHERE np.nota_id = $1 AND np.producto_id = a.id`,
    [notaId]
  );
  await client.query('DELETE FROM nota_productos WHERE nota_id = $1', [notaId]);
}

// Valida y tarifica las cargas recibidas en el body. Cada carga puede traer:
//   { lavadora_id, secadora_id, tipo_prenda, tipo_tela, tamano_edredon,
//     tamano, ajuste, productos: [{ producto_id, cantidad }] }
// (todo opcional salvo que la modalidad lo exija). Devuelve las filas listas
// para insertar o lanza un Error con el mensaje para el cliente.
async function prepararCargas(client, cargas, tipoPrendaNota, sucursal) {
  if (!Array.isArray(cargas) || cargas.length === 0) {
    throw new Error('cargas debe ser una lista con al menos una carga.');
  }
  if (cargas.length > 20) {
    throw new Error('Máximo 20 cargas por nota.');
  }
  const ids = [...new Set(
    cargas.flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean).map(Number)
  )];
  const tipoPorId = new Map();
  const tamanoPorId = new Map();
  if (ids.length > 0) {
    const { rows } = await client.query(
      'SELECT id, tipo, tamano FROM maquinas WHERE id = ANY($1) AND sucursal = $2',
      [ids, sucursal]
    );
    rows.forEach(r => { tipoPorId.set(Number(r.id), r.tipo); tamanoPorId.set(Number(r.id), r.tamano); });
    const faltante = ids.find(id => !tipoPorId.has(id));
    if (faltante) throw new Error(`La máquina ${faltante} no existe.`);
  }
  const t = await tarifasCarga(client);
  return cargas.map((c, i) => {
    const lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
    const secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
    const prendaCarga = (c.tipo_prenda ? String(c.tipo_prenda).toUpperCase() : tipoPrendaNota) || 'ROPA';
    if (c.tipo_prenda && !TIPOS_PRENDA_VALIDOS.includes(prendaCarga)) {
      throw new Error(`tipo_prenda inválido en la carga ${i + 1}.`);
    }
    if (c.tamano && !TAMANOS_VALIDOS.includes(String(c.tamano).toLowerCase())) {
      throw new Error(`tamano inválido en la carga ${i + 1}.`);
    }
    if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
      throw new Error(`La máquina de lavado de la carga ${i + 1} es una secadora.`);
    }
    if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
      throw new Error(`La máquina de secado de la carga ${i + 1} no es una secadora.`);
    }
    if (prendaCarga === 'EDREDON' && lavadoraId && tipoPorId.get(lavadoraId) !== 'lavadora_jumbo') {
      throw new Error(`Los edredones solo van en lavadora jumbo (carga ${i + 1}).`);
    }
    const ajusteCarga = c.ajuste != null && c.ajuste !== '' ? Number(c.ajuste) : 0;
    if (!Number.isFinite(ajusteCarga)) {
      throw new Error(`ajuste inválido en la carga ${i + 1}.`);
    }
    const productos = Array.isArray(c.productos)
      ? c.productos
          .filter(p => p.producto_id && p.cantidad && Number(p.cantidad) > 0)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) }))
      : [];
    return {
      orden:           i + 1,
      lavadora_id:     lavadoraId,
      secadora_id:     secadoraId,
      precio_lavadora: lavadoraId ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t) : 0,
      precio_secadora: secadoraId ? tarifaSecadora(tamanoPorId.get(secadoraId), prendaCarga, t) : 0,
      tipo_prenda:     c.tipo_prenda ? prendaCarga : null,
      tipo_tela:       prendaCarga === 'ROPA' && c.tipo_tela ? String(c.tipo_tela).trim() : null,
      tamano_edredon:  prendaCarga === 'EDREDON' && c.tamano_edredon ? String(c.tamano_edredon).trim() : null,
      tamano:          c.tamano ? String(c.tamano).toLowerCase() : null,
      ajuste:          ajusteCarga,
      // Tomar la(s) máquina(s) de la carga al crear. Por defecto sí (Autoservicio
      // arranca de inmediato); en Por Encargo cada carga decide con `activar`.
      activar:         c.activar !== false,
      productos,
    };
  });
}

// Inserta las filas de nota_cargas ya preparadas (con sus productos, que
// reservan stock). Devuelve las cargas con sus productos.
async function insertarCargas(client, notaId, filas, sucursal) {
  const insertadas = [];
  for (const f of filas) {
    const { rows } = await client.query(
      `INSERT INTO nota_cargas
         (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
          precio_lavadora, precio_secadora,
          tipo_prenda, tipo_tela, tamano_edredon, tamano, ajuste)
       VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [notaId, f.orden, f.lavadora_id, f.secadora_id, f.precio_lavadora, f.precio_secadora,
       f.tipo_prenda, f.tipo_tela, f.tamano_edredon, f.tamano, f.ajuste]
    );
    const carga = rows[0];
    const productos = [];
    for (const p of (f.productos ?? [])) {
      productos.push(await reservarProducto(client, notaId, carga.id, p.producto_id, p.cantidad, sucursal));
    }
    insertadas.push({ ...carga, productos });
  }
  return insertadas;
}

// Cargas de una nota con los datos de sus máquinas y sus productos (detalle).
async function cargasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.id, nc.orden, nc.lavadora_id, nc.secadora_id,
            nc.precio_lavadora, nc.precio_secadora, nc.es_adicional,
            nc.tipo_prenda, nc.tipo_tela, nc.tamano_edredon, nc.tamano, nc.ajuste,
            ml.nombre AS lavadora_nombre, ml.tipo AS lavadora_tipo, ml.estado AS lavadora_estado,
            ml.en_uso_desde AS lavadora_en_uso_desde,
            ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo, ms.estado AS secadora_estado,
            ms.tamano AS secadora_tamano, ms.en_uso_desde AS secadora_en_uso_desde,
            nc.lavadora_usada_id, nc.secadora_usada_id,
            nc.lavadora_removida, nc.secadora_removida,
            mlu.nombre AS lavadora_usada_nombre, mlu.tipo AS lavadora_usada_tipo,
            msu.nombre AS secadora_usada_nombre, msu.tipo AS secadora_usada_tipo,
            msu.tamano AS secadora_usada_tamano
       FROM nota_cargas nc
       LEFT JOIN maquinas ml  ON ml.id  = nc.lavadora_id
       LEFT JOIN maquinas ms  ON ms.id  = nc.secadora_id
       LEFT JOIN maquinas mlu ON mlu.id = nc.lavadora_usada_id
       LEFT JOIN maquinas msu ON msu.id = nc.secadora_usada_id
      WHERE nc.nota_id = $1
      ORDER BY nc.orden ASC`,
    [notaId]
  );
  const { rows: prods } = await client.query(
    `SELECT np.id, np.carga_id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
            (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
      WHERE np.nota_id = $1 AND np.carga_id IS NOT NULL
      ORDER BY np.created_at ASC`,
    [notaId]
  );
  return rows.map(c => ({ ...c, productos: prods.filter(p => p.carga_id === c.id) }));
}

// Verifica que un registro exista y pertenezca a la sucursal indicada.
// Solo se llama con nombres de tabla constantes (clientes / maquinas).
async function perteneceASucursal(tabla, id, sucursal) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${tabla} WHERE id = $1 AND sucursal = $2`,
    [id, sucursal]
  );
  return rows.length > 0;
}

// Deja rastro en la campana del Dashboard cuando se revierte un pago
// (PAGADO → PENDIENTE): es el vector directo para desaparecer una venta,
// así que siempre queda registrado quién lo hizo y en qué nota.
async function registrarReversionPago(client, nota, usuarioId, sucursal) {
  const { rows } = await client.query('SELECT nombre FROM usuarios WHERE id = $1', [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un administrador';
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('pago_revertido', $1, $2, $3)`,
    [`Pago revertido en la nota ${nota.folio ?? `#${nota.id}`} por ${quien}`, usuarioId, sucursal]
  );
}

// Deja rastro en la campana del Dashboard cuando se cancela una nota: es una
// acción fuerte (libera stock y máquinas), así que siempre queda registrado
// quién la canceló y qué nota fue.
async function registrarCancelacionNota(client, nota, usuarioId, sucursal) {
  const { rows } = await client.query('SELECT nombre FROM usuarios WHERE id = $1', [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un empleado';
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('nota_cancelada', $1, $2, $3)`,
    [`Nota ${nota.folio ?? `#${nota.id}`} cancelada por ${quien}`, usuarioId, sucursal]
  );
}

// Deja rastro en la campana del Dashboard cuando se elimina una nota: borra el
// registro por completo, así que siempre queda constancia de quién la eliminó y
// qué nota era.
async function registrarEliminacionNota(client, nota, usuarioId, sucursal) {
  const { rows } = await client.query('SELECT nombre FROM usuarios WHERE id = $1', [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un administrador';
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('nota_eliminada', $1, $2, $3)`,
    [`Nota ${nota.folio ?? `#${nota.id}`} eliminada por ${quien}`, usuarioId, sucursal]
  );
}

function generarFolio(id, fecha) {
  const d = new Date(fecha);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(id).padStart(4, '0');
  return `${seq}-${dd}${mm}${yy}`;
}

// ── GET /notas/next-folio ───────────────────────────────────
export const getNextFolio = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM notas'
    );
    const folio = generarFolio(rows[0].next_id, new Date());
    res.json({ folio });
  } catch (err) {
    console.error('getNextFolio error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /notas ──────────────────────────────────────────────
export const getNotas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              s.nombre   AS secadora_nombre,
              (SELECT COALESCE(json_agg(DISTINCT x.mid), '[]'::json)
                 FROM (${SQL_MAQUINAS_DE_NOTA}) x
                WHERE x.mid IS NOT NULL) AS maquinas_ids,
              -- Nombres de todas las máquinas que la nota usa o usó: además de
              -- las vinculadas, incluye las columnas *_usada_id de las cargas,
              -- que conservan la máquina aunque ya se haya desvinculado (p. ej.
              -- tras pasar el lavado a la secadora).
              (SELECT COALESCE(json_agg(mm.nombre ORDER BY mm.nombre), '[]'::json)
                 FROM (
                   SELECT nc.lavadora_id       AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_id        FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.lavadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT nc.secadora_usada_id  FROM nota_cargas nc WHERE nc.nota_id = n.id
                   UNION SELECT n.maquina_id
                   UNION SELECT n.secadora_id
                 ) xm
                 JOIN maquinas mm ON mm.id = xm.mid) AS maquinas_nombres,
              -- Fases vivas de la nota: si tiene lavadora(s) y/o secadora(s)
              -- realmente EN USO ahora mismo (no solo asignadas: una máquina
              -- asignada pero sin iniciar no cuenta). Con varias cargas puede
              -- tener ambas a la vez (una lavando, otra secando). Para notas
              -- legadas (sin cargas) usa maquina_id / secadora_id.
              (CASE WHEN EXISTS (SELECT 1 FROM nota_cargas nc WHERE nc.nota_id = n.id)
                    THEN EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ml ON ml.id = nc.lavadora_id
                                  WHERE nc.nota_id = n.id AND ml.estado = 'en_uso')
                    ELSE (m.id IS NOT NULL AND m.estado = 'en_uso') END) AS hay_lavadora_activa,
              (CASE WHEN EXISTS (SELECT 1 FROM nota_cargas nc WHERE nc.nota_id = n.id)
                    THEN EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ms ON ms.id = nc.secadora_id
                                  WHERE nc.nota_id = n.id AND ms.estado = 'en_uso')
                    ELSE (s.id IS NOT NULL AND s.estado = 'en_uso') END) AS hay_secadora_activa
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.sucursal = $1
       ORDER BY n.created_at DESC`,
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /notas/:id ──────────────────────────────────────────
export const getNotaById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              m.tipo     AS maquina_tipo,
              m.estado   AS maquina_estado,
              m.en_uso_desde AS maquina_en_uso_desde,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1 AND n.sucursal = $2`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const { rows: productos } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
              (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
       WHERE np.nota_id = $1 AND np.carga_id IS NULL
       ORDER BY np.created_at ASC`,
      [id]
    );

    const { rows: movs } = await pool.query(
      `SELECT mi.*, i.nombre AS insumo_nombre, i.unidad
       FROM movimientos_insumos mi
       JOIN insumos i ON i.id = mi.insumo_id
       WHERE mi.nota_id = $1`,
      [id]
    );

    const { rows: historial } = await pool.query(
      `SELECT estado, MIN(created_at) AS created_at
       FROM nota_estado_historial
       WHERE nota_id = $1
       GROUP BY estado
       ORDER BY created_at ASC`,
      [id]
    );

    const cargas = await cargasDeNota(pool, id);

    res.json({ ...rows[0], productos, cargas, insumos_consumidos: movs, historial_estados: historial });
  } catch (err) {
    console.error('getNotaById error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /notas ─────────────────────────────────────────────
export const createNota = async (req, res) => {
  const {
    cliente_id,
    maquina_id,
    secadora_id,
    modalidad = 'POR_ENCARGO',
    tipo_prenda = 'ROPA',
    estado,
    estado_pago,
    peso_kg,
    precio_total,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    tamano,
    tipo_tela,
    tamano_edredon,
    ajuste = 0,
    cantidad_cargas = 1,
    precio_base,       // precio por carga de la lavadora en AUTOSERVICIO
    cantidad_cargas_secadora,
    precio_base_secadora, // precio por carga de la secadora en AUTOSERVICIO
    cargas,         // AUTOSERVICIO: [{ lavadora_id, secadora_id }] por carga
    insumos   = [], // [{ insumo_id, cantidad }]  → movimientos_insumos
    productos = [], // [{ producto_id, cantidad }] → nota_productos
  } = req.body;

  // Modelo por cargas (Autoservicio y Por Encargo nuevos): la nota trae sus
  // cargas, cada una con sus máquinas y —en encargo— su prenda, tela/tamaño,
  // ajuste y productos. El servidor tarifica por carga.
  const esNotaConCargas = cargas !== undefined;
  if (esNotaConCargas && (!Array.isArray(cargas) || cargas.length === 0)) {
    return res.status(400).json({ message: 'cargas debe ser una lista con al menos una carga.' });
  }

  if (!MODALIDADES_VALIDAS.includes(modalidad)) {
    return res.status(400).json({
      message: `Modalidad inválida. Valores permitidos: ${MODALIDADES_VALIDAS.join(', ')}.`,
    });
  }
  if (!TIPOS_PRENDA_VALIDOS.includes(String(tipo_prenda).toUpperCase())) {
    return res.status(400).json({
      message: `tipo_prenda inválido. Valores permitidos: ${TIPOS_PRENDA_VALIDOS.join(', ')}.`,
    });
  }
  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }
  if (modalidad === 'POR_ENCARGO') {
    if (!cliente_id) {
      return res.status(400).json({ message: 'cliente_id es requerido para notas Por Encargo.' });
    }
    // Con el modelo por cargas, el tamaño va en cada carga. El requisito de
    // tamano a nivel nota solo aplica al flujo legado (sin cargas).
    if (!esNotaConCargas && String(tipo_prenda).toUpperCase() !== 'EDREDON') {
      if (!tamano || !TAMANOS_VALIDOS.includes(String(tamano).toLowerCase())) {
        return res.status(400).json({ message: 'tamano es requerido para Por Encargo (chico o grande).' });
      }
    }
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `tiempo_entrega inválido. Valores permitidos: ${TIEMPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }
  if (estado && !ESTADOS_INICIALES.includes(estado)) {
    return res.status(400).json({
      message: `Estado inicial inválido. Valores permitidos: ${ESTADOS_INICIALES.join(', ')}.`,
    });
  }
  // Estado inicial: LAVANDO por defecto (SECANDO si la única máquina es una
  // secadora); EN_ESPERA si así se indica.
  const estadoInicial = estado || (!maquina_id && secadora_id ? 'SECANDO' : 'LAVANDO');

  // Montos: numéricos y sin negativos. El ajuste sí puede ser negativo
  // (es el descuento del formulario), pero el total final de la nota no;
  // eso se verifica antes del COMMIT, ya con los productos sumados.
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'ajuste debe ser numérico.' });
  }
  if (cantidad_cargas != null && cantidad_cargas !== '' &&
      (!Number.isInteger(Number(cantidad_cargas)) || Number(cantidad_cargas) < 1)) {
    return res.status(400).json({ message: 'cantidad_cargas debe ser un entero mayor o igual a 1.' });
  }
  if (precio_base != null && precio_base !== '' &&
      (!Number.isFinite(Number(precio_base)) || Number(precio_base) < 0)) {
    return res.status(400).json({ message: 'precio_base debe ser un número mayor o igual a 0.' });
  }
  if (precio_total != null && precio_total !== '' &&
      (!Number.isFinite(Number(precio_total)) || Number(precio_total) < 0)) {
    return res.status(400).json({ message: 'precio_total debe ser un número mayor o igual a 0.' });
  }

  // Los IDs referenciados deben pertenecer a la sucursal activa.
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'cliente_id no existe.' });
  }
  if (maquina_id && !(await perteneceASucursal('maquinas', maquina_id, req.sucursal))) {
    return res.status(400).json({ message: 'maquina_id no existe.' });
  }
  if (secadora_id && !(await perteneceASucursal('maquinas', secadora_id, req.sucursal))) {
    return res.status(400).json({ message: 'secadora_id no existe.' });
  }

  const ajusteNum      = Number(ajuste)         || 0;
  const cantidadCargas = Number(cantidad_cargas) || 1;

  // Leer precio desde ajustes si no se envió en el body (flujo legado sin
  // cargas: Por Encargo y notas viejas). Depende del tipo de máquina
  // (mediana / jumbo / secadora) y la modalidad (EDREDON en jumbo tiene su
  // propia tarifa). Con cargas, la tarificación es por carga más adelante.
  let precioBaseNum = precio_base != null ? Number(precio_base) : null;
  if (precioBaseNum === null && !esNotaConCargas) {
    let tipoMaquina = null;
    if (maquina_id) {
      const { rows: maq } = await pool.query('SELECT tipo FROM maquinas WHERE id = $1', [maquina_id]);
      tipoMaquina = maq[0]?.tipo ?? null;
    }
    const { rows: cfg } = await pool.query(
      `SELECT precio_carga_mediana, precio_carga_jumbo,
              precio_carga_secadora, precio_edredon_jumbo
       FROM ajustes WHERE id = 1`
    );
    if (cfg.length > 0) {
      const c = cfg[0];
      const esEdredon = String(tipo_prenda).toUpperCase() === 'EDREDON';
      if (tipoMaquina === 'secadora') {
        precioBaseNum = Number(c.precio_carga_secadora);
      } else if (tipoMaquina === 'lavadora_jumbo' && esEdredon) {
        precioBaseNum = Number(c.precio_edredon_jumbo);
      } else if (tipoMaquina === 'lavadora_jumbo') {
        precioBaseNum = Number(c.precio_carga_jumbo);
      } else {
        precioBaseNum = Number(c.precio_carga_mediana);
      }
    } else {
      precioBaseNum = 70;
    }
  }

  // Secadora (Autoservicio): cargas y tarifa propias, independientes de la
  // lavadora. Si no viene, no aporta al total.
  const cargasSecadoraNum = cantidad_cargas_secadora != null && cantidad_cargas_secadora !== ''
    ? Number(cantidad_cargas_secadora)
    : null;
  const precioBaseSecadoraNum = precio_base_secadora != null && precio_base_secadora !== ''
    ? Number(precio_base_secadora)
    : null;
  const subtotalSecadora = (cargasSecadoraNum || 0) * (precioBaseSecadoraNum || 0);

  // precio_total = (cargas_lav × precio_base) + (cargas_sec × precio_base_sec) + ajuste
  // Los productos se suman después de insertarlos en nota_productos.
  const precioFinal = precioBaseNum != null
    ? cantidadCargas * precioBaseNum + subtotalSecadora + ajusteNum
    : (precio_total ? Number(precio_total) : null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Con cargas, se validan y tarifican primero; de ellas salen los valores
    // denormalizados de la nota (primera lavadora/secadora, conteo y total).
    let filasCargas = null;
    if (esNotaConCargas) {
      try {
        filasCargas = await prepararCargas(client, cargas, tipo_prenda, req.sucursal);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
    }
    const cargasSum = filasCargas
      ? filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0)
      : null;
    const maquinaIdNota  = filasCargas
      ? (filasCargas.find(f => f.lavadora_id)?.lavadora_id ?? null)
      : (maquina_id || null);
    const secadoraIdNota = filasCargas
      ? (filasCargas.find(f => f.secadora_id)?.secadora_id ?? null)
      : (secadora_id || null);

    // Máquinas a tomar al crear: solo las de las cargas que se activan. Si
    // ninguna se activa, la nota nace En Espera (las máquinas quedan asignadas
    // pero libres, para activarse luego desde Salidas).
    const idsActivar = filasCargas
      ? [...new Set(filasCargas.filter(f => f.activar).flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))]
      : [];
    const estadoNota = filasCargas
      ? (idsActivar.length > 0
          ? (filasCargas.some(f => f.activar && f.lavadora_id) ? 'LAVANDO' : 'SECANDO')
          : 'EN_ESPERA')
      : estadoInicial;

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, maquina_id, secadora_id, modalidad, tipo_prenda, estado, estado_pago, sucursal,
          peso_kg, precio_total, fecha_entrega, tiempo_entrega, instrucciones,
          tamano, tipo_tela, tamano_edredon, precio_base, ajuste, cantidad_cargas,
          cantidad_cargas_secadora, precio_base_secadora)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        maquinaIdNota,
        secadoraIdNota,
        modalidad,
        String(tipo_prenda).toUpperCase(),
        estadoNota,
        estado_pago,
        req.sucursal,
        peso_kg      || null,
        filasCargas ? cargasSum + ajusteNum : precioFinal,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        instrucciones || null,
        tamano ? String(tamano).toLowerCase() : null,
        tipo_tela ? String(tipo_tela).trim() : null,
        tamano_edredon ? String(tamano_edredon).trim() : null,
        filasCargas ? null : precioBaseNum,
        ajusteNum,
        filasCargas ? filasCargas.length : cantidadCargas,
        filasCargas ? null : cargasSecadoraNum,
        filasCargas ? null : precioBaseSecadoraNum,
      ]
    );
    const nota = notaRows[0];

    const folio = generarFolio(nota.id, nota.created_at);
    await client.query('UPDATE notas SET folio = $1 WHERE id = $2', [folio, nota.id]);
    nota.folio = folio;

    // Insertar las cargas y tomar las máquinas de las cargas activadas.
    let cargasInsertadas = [];
    if (filasCargas) {
      cargasInsertadas = await insertarCargas(client, nota.id, filasCargas, req.sucursal);
      if (idsActivar.length > 0) {
        const { rows: maqs } = await client.query(
          'SELECT id, nombre, estado FROM maquinas WHERE id = ANY($1) FOR UPDATE',
          [idsActivar]
        );
        const ocupada = maqs.find(m => m.estado !== 'disponible');
        if (ocupada) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `La máquina ${ocupada.nombre} no está disponible.` });
        }
        await client.query(
          `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
          [idsActivar]
        );
        await sellarCicloMaquinas(client, nota.id);
      }
    }

    if (modalidad === 'POR_ENCARGO' || modalidad === 'AUTOSERVICIO') {
      for (const { insumo_id, cantidad } of insumos) {
        if (!insumo_id || !cantidad || cantidad <= 0) continue;

        const { rows: stockRows } = await client.query(
          'SELECT stock_actual FROM insumos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
          [insumo_id, req.sucursal]
        );
        if (stockRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: `Insumo ${insumo_id} no encontrado.` });
        }
        if (Number(stockRows[0].stock_actual) < cantidad) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: `Stock insuficiente para insumo ${insumo_id}.` });
        }

        await client.query(
          `INSERT INTO movimientos_insumos (insumo_id, usuario_id, nota_id, tipo, cantidad)
           VALUES ($1, $2, $3, 'salida', $4)`,
          [insumo_id, req.user.id, nota.id, cantidad]
        );
        await client.query(
          'UPDATE insumos SET stock_actual = stock_actual - $1 WHERE id = $2',
          [cantidad, insumo_id]
        );
      }
    }

    // ── Insertar productos en nota_productos ────────────────
    const productosInsertados = [];
    for (const { producto_id, cantidad } of productos) {
      if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;

      const { rows: artRows } = await client.query(
        'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
        [producto_id, req.sucursal]
      );
      if (artRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: `Producto ${producto_id} no encontrado.` });
      }
      const art = artRows[0];
      const stockDisponible = art.stock_actual - art.stock_reservado;
      if (stockDisponible < Number(cantidad)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Stock insuficiente para "${art.nombre}". Disponible: ${stockDisponible}, solicitado: ${cantidad}.`,
        });
      }

      const { rows: npRows } = await client.query(
        `INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [nota.id, producto_id, cantidad, art.precio_unitario ?? 0]
      );
      await client.query(
        'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
        [cantidad, producto_id]
      );
      productosInsertados.push({
        ...npRows[0],
        nombre:  art.nombre,
        subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario),
      });
    }

    // Recalcular precio_total con la fórmula completa (cargas + productos + ajuste).
    if (productosInsertados.length > 0 || filasCargas) {
      nota.precio_total = await recalcularPrecioTotal(client, nota.id);
    }

    if (nota.precio_total != null && Number(nota.precio_total) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El total de la nota no puede ser negativo. Revisa el ajuste.' });
    }

    const errTope = await validarTopesCargas(client, nota.id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');
    res.status(201).json({ ...nota, cargas: cargasInsertadas, productos: productosInsertados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createNota error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'cliente_id o maquina_id no existe.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id ────────────────────────────────────────
export const updateNota = async (req, res) => {
  const { id } = req.params;
  const {
    cliente_id,
    maquina_id,
    secadora_id,
    estado_pago,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    tamano,
    tipo_prenda,
    tipo_tela,
    tamano_edredon,
    ajuste,
    cantidad_cargas,
    precio_base,
    cantidad_cargas_secadora,
    precio_base_secadora,
    cargas,
    productos,
  } = req.body;

  if (productos !== undefined && !Array.isArray(productos)) {
    return res.status(400).json({ message: 'productos debe ser una lista.' });
  }
  if (cargas !== undefined && (!Array.isArray(cargas) || cargas.length === 0)) {
    return res.status(400).json({ message: 'cargas debe ser una lista con al menos una carga.' });
  }
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'ajuste debe ser numérico.' });
  }
  if (cantidad_cargas != null && cantidad_cargas !== '' &&
      (!Number.isInteger(Number(cantidad_cargas)) || Number(cantidad_cargas) < 1)) {
    return res.status(400).json({ message: 'cantidad_cargas debe ser un entero mayor o igual a 1.' });
  }
  if (precio_base != null && precio_base !== '' &&
      (!Number.isFinite(Number(precio_base)) || Number(precio_base) < 0)) {
    return res.status(400).json({ message: 'precio_base debe ser un número mayor o igual a 0.' });
  }
  if (estado_pago && !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }
  if (tamano && !TAMANOS_VALIDOS.includes(String(tamano).toLowerCase())) {
    return res.status(400).json({
      message: `tamano inválido. Valores permitidos: ${TAMANOS_VALIDOS.join(', ')}.`,
    });
  }
  if (tipo_prenda && !TIPOS_PRENDA_VALIDOS.includes(String(tipo_prenda).toUpperCase())) {
    return res.status(400).json({
      message: `tipo_prenda inválido. Valores permitidos: ${TIPOS_PRENDA_VALIDOS.join(', ')}.`,
    });
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `tiempo_entrega inválido. Valores permitidos: ${TIEMPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }

  // Los IDs referenciados deben pertenecer a la sucursal activa.
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'cliente_id no existe.' });
  }
  if (maquina_id && !(await perteneceASucursal('maquinas', maquina_id, req.sucursal))) {
    return res.status(400).json({ message: 'maquina_id no existe.' });
  }
  if (secadora_id && !(await perteneceASucursal('maquinas', secadora_id, req.sucursal))) {
    return res.status(400).json({ message: 'secadora_id no existe.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      'SELECT * FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (currentRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const actual = currentRows[0];

    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(actual.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede editar una nota en estado ${actual.estado}.`,
      });
    }

    // Revertir un pago desde el formulario de edición tiene el mismo
    // control que el endpoint de estado-pago: solo admin, y con rastro.
    const esReversionPago = estado_pago === 'PENDIENTE' && actual.estado_pago === 'PAGADO';
    if (esReversionPago && !esAdmin(req.user.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede revertir un pago.' });
    }

    // Cargas (autoservicio): la lista enviada reemplaza todas las de la nota,
    // igual que productos. Se retarifican en el servidor y, si la nota está
    // activa, se liberan las máquinas que salieron y se toman las nuevas.
    let filasCargas = null;
    let cargasNota  = null;
    if (cargas !== undefined) {
      const maquinasAntes = await maquinasDeNota(client, id);
      const prendaEfectiva = tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda;
      try {
        filasCargas = await prepararCargas(client, cargas, prendaEfectiva, req.sucursal);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
      // Liberar el stock reservado de los productos de las cargas viejas antes
      // de borrarlas (el ON DELETE CASCADE elimina las filas pero no revierte
      // stock_reservado). Los nuevos productos se reservan en insertarCargas.
      await client.query(
        `UPDATE productos a
            SET stock_reservado = stock_reservado - np.cantidad
          FROM nota_productos np
          WHERE np.nota_id = $1 AND np.carga_id IS NOT NULL AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_cargas WHERE nota_id = $1', [id]);
      cargasNota = await insertarCargas(client, id, filasCargas, req.sucursal);

      if (['LAVANDO', 'SECANDO'].includes(actual.estado)) {
        const despues = new Set(
          filasCargas.flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean)
        );
        const liberar = maquinasAntes.filter(mid => !despues.has(mid));
        if (liberar.length > 0) {
          await client.query(
            `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
              WHERE id = ANY($1) AND estado = 'en_uso'`,
            [liberar]
          );
        }
        const tomar = [...despues].filter(mid => !maquinasAntes.includes(mid));
        if (tomar.length > 0) {
          await client.query(
            `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW()
              WHERE id = ANY($1) AND estado = 'disponible'`,
            [tomar]
          );
        }
        await sellarCicloMaquinas(client, id);
      }
    }

    // PATCH real (auditoría A4): solo los campos presentes en el body se
    // modifican; los ausentes conservan su valor. JSON no puede mandar
    // undefined, así que "presente" = la clave viene en el body.
    const tiene = (campo) => req.body[campo] !== undefined;

    const ajusteNum = tiene('ajuste')
      ? Number(ajuste) || 0
      : Number(actual.ajuste) || 0;
    const cantidadCargasNum = tiene('cantidad_cargas')
      ? Number(cantidad_cargas) || 1
      : Number(actual.cantidad_cargas) || 1;
    const precioBaseNum = precio_base != null && precio_base !== ''
      ? Number(precio_base)
      : actual.precio_base != null ? Number(actual.precio_base) : null;
    const cargasSecadoraNum = tiene('cantidad_cargas_secadora')
      ? (cantidad_cargas_secadora != null && cantidad_cargas_secadora !== '' ? Number(cantidad_cargas_secadora) : null)
      : (actual.cantidad_cargas_secadora != null ? Number(actual.cantidad_cargas_secadora) : null);
    const precioBaseSecadoraNum = tiene('precio_base_secadora')
      ? (precio_base_secadora != null && precio_base_secadora !== '' ? Number(precio_base_secadora) : null)
      : (actual.precio_base_secadora != null ? Number(actual.precio_base_secadora) : null);
    const subtotalSecadora = (cargasSecadoraNum || 0) * (precioBaseSecadoraNum || 0);

    // Los productos solo se tocan si vienen en el body: la lista enviada
    // (aun vacía) reemplaza los de la nota; ausente, se conservan.
    let productosNota;
    if (productos !== undefined) {
      // Solo los productos a nivel nota (carga_id IS NULL, autoservicio); los
      // de cargas se manejan junto con sus cargas.
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.carga_id IS NULL AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_productos WHERE nota_id = $1 AND carga_id IS NULL', [id]);

      // Insertar los nuevos productos
      const productosInsertados = [];
      for (const { producto_id, cantidad } of productos) {
        if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;

        const { rows: artRows } = await client.query(
          'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
          [producto_id, req.sucursal]
        );
        if (artRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: `Producto ${producto_id} no encontrado.` });
        }
        const art = artRows[0];
        const stockDisponible = Number(art.stock_actual) - Number(art.stock_reservado);
        if (stockDisponible < Number(cantidad)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            message: `Stock insuficiente para "${art.nombre}". Disponible: ${stockDisponible}, solicitado: ${cantidad}.`,
          });
        }

        const { rows: npRows } = await client.query(
          `INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [id, producto_id, cantidad, art.precio_unitario ?? 0]
        );
        await client.query(
          'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
          [cantidad, producto_id]
        );
        productosInsertados.push({
          ...npRows[0],
          nombre: art.nombre,
          subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario),
        });
      }
      productosNota = productosInsertados;
    } else {
      const { rows: existentes } = await client.query(
        `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
                (np.cantidad * np.precio_unitario) AS subtotal
         FROM nota_productos np
         JOIN productos a ON a.id = np.producto_id
         WHERE np.nota_id = $1 AND np.carga_id IS NULL
         ORDER BY np.created_at ASC`,
        [id]
      );
      productosNota = existentes;
    }

    // Suma de cargas: las recién enviadas o las existentes de la nota.
    // Si la nota tiene cargas, mandan ellas sobre la fórmula legada.
    let cargasSum = null;
    if (filasCargas) {
      cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);
    } else {
      const { rows: sumRows } = await client.query(
        'SELECT SUM(precio_lavadora + precio_secadora) AS s FROM nota_cargas WHERE nota_id = $1',
        [id]
      );
      cargasSum = sumRows[0]?.s != null ? Number(sumRows[0].s) : null;
    }

    const subtotalProductos = productosNota.reduce((s, p) => s + Number(p.subtotal), 0);
    const precioFinal = cargasSum != null
      ? cargasSum + ajusteNum + subtotalProductos
      : (precioBaseNum != null
          ? cantidadCargasNum * precioBaseNum + subtotalSecadora + ajusteNum + subtotalProductos
          : null);

    const { rows } = await client.query(
      `UPDATE notas SET
         cliente_id      = $2,
         maquina_id      = $3,
         estado_pago     = $4,
         fecha_entrega   = $5,
         tiempo_entrega  = $6,
         instrucciones   = $7,
         tamano          = $8,
         tipo_prenda     = $9,
         tipo_tela       = $10,
         tamano_edredon  = $11,
         precio_base     = $12,
         ajuste          = $13,
         cantidad_cargas = $14,
         precio_total    = $15,
         secadora_id     = $16,
         cantidad_cargas_secadora = $17,
         precio_base_secadora     = $18
       WHERE id = $1
       RETURNING *`,
      [
        id,
        tiene('cliente_id')     ? (cliente_id || null) : actual.cliente_id,
        // Con cargas, la lavadora/secadora de la nota se denormalizan de la
        // primera carga que las tenga (para la lista y vistas legadas).
        filasCargas
          ? (filasCargas.find(f => f.lavadora_id)?.lavadora_id ?? null)
          : (tiene('maquina_id') ? (maquina_id || null) : actual.maquina_id),
        estado_pago || actual.estado_pago,
        tiene('fecha_entrega')  ? (fecha_entrega || null) : actual.fecha_entrega,
        tiene('tiempo_entrega') ? (tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null) : actual.tiempo_entrega,
        tiene('instrucciones')  ? (instrucciones || null) : actual.instrucciones,
        tamano ? String(tamano).toLowerCase() : actual.tamano,
        tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda,
        tiene('tipo_tela')      ? (tipo_tela ? String(tipo_tela).trim() : null) : actual.tipo_tela,
        tiene('tamano_edredon') ? (tamano_edredon ? String(tamano_edredon).trim() : null) : actual.tamano_edredon,
        filasCargas ? null : precioBaseNum,
        ajusteNum,
        filasCargas ? filasCargas.length : cantidadCargasNum,
        precioFinal,
        filasCargas
          ? (filasCargas.find(f => f.secadora_id)?.secadora_id ?? null)
          : (tiene('secadora_id') ? (secadora_id || null) : actual.secadora_id),
        filasCargas ? null : cargasSecadoraNum,
        filasCargas ? null : precioBaseSecadoraNum,
      ]
    );

    if (rows[0].precio_total != null && Number(rows[0].precio_total) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El total de la nota no puede ser negativo. Revisa el ajuste.' });
    }

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    if (esReversionPago) {
      await registrarReversionPago(client, actual, req.user.id, req.sucursal);
    }

    if (cargasNota === null) {
      cargasNota = await cargasDeNota(client, id);
    }

    await client.query('COMMIT');
    res.json({ ...rows[0], cargas: cargasNota, productos: productosNota });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateNota error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ message: 'cliente_id o maquina_id no existe.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── DELETE /notas/:id ───────────────────────────────────────
export const eliminarNota = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo los administradores pueden eliminar notas.' });
  }
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, folio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const { estado: estadoNota } = notaRows[0];
    // Se recolectan antes del DELETE: el CASCADE borra nota_cargas.
    const maquinasNota = await maquinasDeNota(client, id);

    // El efecto en stock depende del estado de la nota:
    //   - PAGADA: el pago ya consumió stock_actual y liberó la reserva;
    //     eliminar anula la venta y el producto vuelve al estante.
    //   - FINALIZADA / CANCELADA: el stock ya se consumió o la reserva ya
    //     se liberó; no hay nada que revertir.
    //   - Estados activos: solo liberar la reserva.
    if (estadoNota === 'PAGADA') {
      await client.query(
        `UPDATE productos a
           SET stock_actual = stock_actual + np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    } else if (!['FINALIZADA', 'CANCELADA'].includes(estadoNota)) {
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    await client.query('DELETE FROM notas WHERE id = $1', [id]);

    // Liberar las máquinas que estaban en uso por esta nota
    if (maquinasNota.length > 0) {
      await client.query(
        `UPDATE maquinas
           SET estado = 'disponible',
               en_uso_desde = NULL
         WHERE id = ANY($1) AND estado = 'en_uso'`,
        [maquinasNota]
      );
    }

    // Alerta en la campana del Dashboard: la nota se borró por completo.
    await registrarEliminacionNota(client, { id, folio: notaRows[0].folio }, req.user.id, req.sucursal);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('eliminarNota error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/estado ─────────────────────────────────
export const cambiarEstadoNota = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const estadoActual = notaRows[0].estado;

    if (['FINALIZADA', 'CANCELADA'].includes(estadoActual)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede cambiar el estado de una nota ${estadoActual}.`,
      });
    }

    const permitidos = TRANSICIONES_VALIDAS[estadoActual] || [];
    if (!permitidos.includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Transición no válida: ${estadoActual} → ${estado}. Permitidas: ${permitidos.join(', ') || 'ninguna'}.`,
      });
    }

    if (estado === 'CANCELADA') {
      if (estadoActual === 'PAGADA') {
        // El pago ya consumió stock_actual y liberó la reserva; al anular
        // la venta el producto vuelve al estante.
        await client.query(
          `UPDATE productos a
             SET stock_actual = stock_actual + np.cantidad
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      } else {
        await client.query(
          `UPDATE productos a
             SET stock_reservado = stock_reservado - np.cantidad
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      }
    } else if (estado === 'PAGADA' || (estado === 'FINALIZADA' && estadoActual !== 'PAGADA')) {
      // Consumir stock al cobrar o al entregar, lo que ocurra primero.
      // (PAGADA → FINALIZADA no vuelve a consumir.)
      await client.query(
        `UPDATE productos a
           SET stock_actual    = stock_actual    - np.cantidad,
               stock_reservado = stock_reservado - np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    const { rows } = await client.query(
      'UPDATE notas SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );

    // Al terminar el ciclo (Por Entregar) o cancelar, la nota suelta todas
    // sus máquinas. El backend es el dueño del ciclo de vida: los clientes
    // ya no necesitan liberar máquina por máquina.
    if (estado === 'LISTA' || estado === 'CANCELADA') {
      await liberarMaquinasDeNota(client, id);
    }

    // Alerta en la campana del Dashboard cuando se cancela una nota.
    if (estado === 'CANCELADA') {
      await registrarCancelacionNota(client, rows[0], req.user.id, req.sucursal);
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarEstadoNota error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/activar-pendientes ─────────────────────
// Activa (marca en uso) las máquinas ya asignadas a la nota que sigan
// disponibles. Sin body activa TODAS; con { maquina_id } activa solo esa (para
// el botón "Iniciar Lavado" por máquina en Salidas). Sirve para poner en marcha
// las cargas que quedaron en espera, tanto en una nota En Espera como en una
// ya En Proceso (caso mixto).
export const activarMaquinasPendientes = async (req, res) => {
  const { id } = req.params;
  const { maquina_id } = req.body ?? {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `No se pueden activar máquinas de una nota ${notaRows[0].estado}.` });
    }

    const ids = await maquinasDeNota(client, id);
    if (ids.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nota no tiene máquinas asignadas.' });
    }
    const { rows: maqs } = await client.query(
      'SELECT id, estado FROM maquinas WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [ids, req.sucursal]
    );
    let libres = maqs.filter(m => m.estado === 'disponible').map(m => m.id);
    if (libres.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No hay máquinas pendientes por activar.' });
    }

    // Con maquina_id se activa solo esa (botón por máquina); debe estar
    // asignada a la nota y disponible.
    if (maquina_id != null) {
      if (!libres.some(x => String(x) === String(maquina_id))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La máquina no está asignada a la nota o no está disponible.' });
      }
      libres = [Number(maquina_id)];
    }

    // Al iniciar el secado de una carga cuya lavadora seguía lavando (en uso),
    // esa lavadora ya cumplió: se captura antes de tomar la secadora para
    // soltarla (desvincular + liberar) después. La carga conserva la lavadora
    // en lavadora_usada_id (historial). Solo aplica a lavadoras realmente en uso.
    const { rows: lavASoltar } = await client.query(
      `SELECT nc.id AS carga_id, nc.lavadora_id
         FROM nota_cargas nc
         JOIN maquinas ml ON ml.id = nc.lavadora_id
        WHERE nc.nota_id = $1 AND nc.secadora_id = ANY($2) AND ml.estado = 'en_uso'`,
      [id, libres]
    );

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
      [libres]
    );

    if (lavASoltar.length > 0) {
      const lavIds   = lavASoltar.map(r => r.lavadora_id);
      const cargaIds = lavASoltar.map(r => r.carga_id);
      await client.query(
        `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL WHERE id = ANY($1)`,
        [lavIds]
      );
      await client.query(
        'UPDATE nota_cargas SET lavadora_id = NULL WHERE id = ANY($1)',
        [cargaIds]
      );
    }

    await sellarCicloMaquinas(client, id);
    // La nota queda en la fase que dicten sus máquinas: si se activó una
    // lavadora vuelve/queda en LAVANDO; si solo corren secadoras, SECANDO.
    const fase = await faseProcesoDeNota(client, id);
    await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [fase, id]);

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*, m.nombre AS maquina_nombre, m.tipo AS maquina_tipo, m.estado AS maquina_estado,
              s.nombre AS secadora_nombre, s.tipo AS secadora_tipo, s.estado AS secadora_estado
         FROM notas n
         LEFT JOIN maquinas m ON m.id = n.maquina_id
         LEFT JOIN maquinas s ON s.id = n.secadora_id
        WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('activarMaquinasPendientes error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-secadora ───────────────────────
// Asigna una secadora a una nota en proceso: la agrega a las primeras N
// cargas que aún no tienen secadora, marca la máquina en uso y suma su
// tarifa al total.
export const asignarSecadora = async (req, res) => {
  const { id } = req.params;
  const { secadora_id, cantidad_cargas_secadora } = req.body;

  if (!secadora_id) {
    return res.status(400).json({ message: 'secadora_id es requerido.' });
  }
  if (cantidad_cargas_secadora != null && cantidad_cargas_secadora !== '' &&
      (!Number.isInteger(Number(cantidad_cargas_secadora)) || Number(cantidad_cargas_secadora) < 1)) {
    return res.status(400).json({ message: 'cantidad_cargas_secadora debe ser un entero mayor o igual a 1.' });
  }
  const cargasPedidas = cantidad_cargas_secadora != null && cantidad_cargas_secadora !== ''
    ? Number(cantidad_cargas_secadora)
    : 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, secadora_id FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const nota = notaRows[0];
    if (!['LAVANDO', 'SECANDO'].includes(nota.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede asignar una secadora a una nota en proceso.' });
    }

    // La secadora se agrega a las primeras N cargas que no tienen una. Se trae
    // la lavadora (actual o ya usada) y la prenda de cada carga para tarifar el
    // secado por su categoría (mirror de la lavadora).
    const { rows: sinSecadora } = await client.query(
      `SELECT nc.id, nc.tipo_prenda, ml.tipo AS lavadora_tipo
         FROM nota_cargas nc
         LEFT JOIN maquinas ml ON ml.id = COALESCE(nc.lavadora_id, nc.lavadora_usada_id)
        WHERE nc.nota_id = $1 AND nc.secadora_id IS NULL
        ORDER BY nc.orden ASC
        FOR UPDATE OF nc`,
      [id]
    );
    if (sinSecadora.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nota no tiene cargas sin secadora.' });
    }
    const objetivo = sinSecadora.slice(0, cargasPedidas);

    const { rows: maqRows } = await client.query(
      'SELECT tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [secadora_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no existe.' });
    }
    if (maqRows[0].tipo !== 'secadora') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no es una secadora.' });
    }
    if (maqRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no está disponible.' });
    }
    const secadoraTamano = maqRows[0].tamano;

    const t = await tarifasCarga(client);

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    // Cada carga cobra el secado según el tamaño de la secadora (prenda edredón
    // manda sobre el tamaño).
    for (const c of objetivo) {
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    // Denormalización: la primera secadora de la nota, para lista y vistas legadas.
    await client.query(
      `UPDATE notas SET secadora_id = COALESCE(secadora_id, $1) WHERE id = $2`,
      [secadora_id, id]
    );
    await sellarCicloMaquinas(client, id);
    await recalcularPrecioTotal(client, id);

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              m.tipo     AS maquina_tipo,
              m.estado   AS maquina_estado,
              m.en_uso_desde AS maquina_en_uso_desde,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('asignarSecadora error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/asignar-maquina ────────────────────────
// Asigna una máquina extra (lavadora o secadora) a la nota creando una CARGA
// NUEVA. La máquina queda ASIGNADA pero disponible (En Espera): NO arranca aquí,
// el empleado la inicia manualmente desde Salidas (igual que al crear la nota).
// `cobrar` decide si la carga suma su tarifa al total (true) o va sin costo
// (false, precio 0). Disponible mientras la nota no esté finalizada ni cancelada.
// No toca estado_pago: igual que agregar productos, un cobro posterior a una
// nota pagada se maneja aparte.
export const asignarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, maquina_ids, cobrar } = req.body;

  // Acepta una máquina (maquina_id, formato viejo) o varias (maquina_ids). Se
  // normaliza a una lista de ids únicos.
  const idsRaw = Array.isArray(maquina_ids) ? maquina_ids
    : (maquina_id != null ? [maquina_id] : []);
  const ids = [...new Set(idsRaw.map(Number).filter(n => Number.isInteger(n)))];

  if (ids.length === 0) {
    return res.status(400).json({ message: 'Selecciona al menos una máquina.' });
  }
  if (typeof cobrar !== 'boolean') {
    return res.status(400).json({ message: 'cobrar es requerido: true (carga por cobrar) o false (sin cobro).' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, tipo_prenda, precio_base FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede asignar una máquina a una nota finalizada o cancelada.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [ids, req.sucursal]
    );
    if (maqRows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Alguna de las máquinas seleccionadas no existe.' });
    }
    const noDisp = maqRows.find(m => m.estado !== 'disponible');
    if (noDisp) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${noDisp.nombre} no está disponible.` });
    }

    // La(s) carga(s) nueva(s) heredan la prenda de la nota para tarifar con su
    // categoría.
    const tipoPrenda = notaRows[0].tipo_prenda ?? null;
    const esEdredon  = String(tipoPrenda).toUpperCase() === 'EDREDON';
    const lavadoras  = maqRows.filter(m => m.tipo !== 'secadora');
    const secadoras  = maqRows.filter(m => m.tipo === 'secadora');
    const lavNoJumbo = esEdredon && lavadoras.find(m => m.tipo !== 'lavadora_jumbo');
    if (lavNoJumbo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
    }

    // Las notas de formato antiguo (legadas) usan precio_base/cantidad_cargas en
    // vez de nota_cargas; crear una carga cambiaría su fórmula de total. Se
    // reconocen por tener precio_base. Una nota de cargas que se quedó sin cargas
    // (p. ej. tras quitar todas) tiene precio_base NULL y sí admite asignar.
    const { rows: [{ max_orden }] } = await client.query(
      'SELECT COALESCE(MAX(orden), 0)::int AS max_orden FROM nota_cargas WHERE nota_id = $1',
      [id]
    );
    if (notaRows[0].precio_base != null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Esta nota es de un formato antiguo; no admite asignar máquinas extra.' });
    }

    const t = await tarifasCarga(client);
    const precioLav = m => cobrar ? tarifaLavadora(m.tipo, tipoPrenda, t) : 0;
    const precioSec = m => cobrar ? tarifaSecadora(m.tamano, tipoPrenda, t) : 0;

    // Empareja lavadora+secadora en una misma carga (un ciclo completo). Las que
    // sobran de un tipo van cada una en su propia carga.
    const nuevas = [];
    const n = Math.max(lavadoras.length, secadoras.length);
    for (let i = 0; i < n; i++) {
      nuevas.push({ lavadora: lavadoras[i] ?? null, secadora: secadoras[i] ?? null });
    }

    // La máquina NO arranca aquí: queda asignada pero disponible (En Espera) y
    // el empleado la inicia manualmente desde Salidas, igual que al crear la nota.
    for (let i = 0; i < nuevas.length; i++) {
      const { lavadora, secadora } = nuevas[i];
      await client.query(
        `INSERT INTO nota_cargas
           (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
            precio_lavadora, precio_secadora, tipo_prenda, es_adicional)
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, TRUE)`,
        [
          id, max_orden + 1 + i,
          lavadora ? lavadora.id : null,
          secadora ? secadora.id : null,
          lavadora ? precioLav(lavadora) : 0,
          secadora ? precioSec(secadora) : 0,
          tipoPrenda,
        ]
      );
    }

    // Denormalizados (primera lavadora/secadora de la nota) y estado según las
    // máquinas EN USO: las nuevas no cuentan (no se iniciaron). Si nada corre, la
    // nota queda En Espera (reabre una nota LISTA para poder iniciarla).
    if (lavadoras[0]) {
      await client.query(
        'UPDATE notas SET maquina_id = COALESCE(maquina_id, $1) WHERE id = $2',
        [lavadoras[0].id, id]
      );
    }
    if (secadoras[0]) {
      await client.query(
        'UPDATE notas SET secadora_id = COALESCE(secadora_id, $1) WHERE id = $2',
        [secadoras[0].id, id]
      );
    }
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    await recalcularPrecioTotal(client, id);

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              m.tipo     AS maquina_tipo,
              m.estado   AS maquina_estado,
              m.en_uso_desde AS maquina_en_uso_desde,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('asignarMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/cambiar-maquina ────────────────────────
// Cambia una máquina ASIGNADA PERO SIN INICIAR de una carga por otra disponible
// del mismo tipo (lavadora↔lavadora, secadora↔secadora). Re-tarifa la carga con
// la nueva máquina (p. ej. secadora mediana→jumbo cambia el precio) y recalcula
// el total. No aplica a máquinas ya en uso: primero hay que detenerlas.
export const cambiarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_actual_id, maquina_nueva_id } = req.body;

  if (!maquina_actual_id || !maquina_nueva_id) {
    return res.status(400).json({ message: 'maquina_actual_id y maquina_nueva_id son requeridos.' });
  }
  if (String(maquina_actual_id) === String(maquina_nueva_id)) {
    return res.status(400).json({ message: 'Selecciona una máquina distinta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede cambiar una máquina de una nota finalizada o cancelada.' });
    }

    // La máquina actual debe estar asignada, disponible (sin iniciar) y en la sucursal.
    const { rows: actRows } = await client.query(
      'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_actual_id, req.sucursal]
    );
    if (actRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina actual no existe.' });
    }
    if (actRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo puedes cambiar una máquina que aún no ha iniciado. Detén su ciclo primero.' });
    }
    const esSecadora = actRows[0].tipo === 'secadora';
    const cargaCol   = esSecadora ? 'secadora_id'        : 'lavadora_id';
    const usadaCol   = esSecadora ? 'secadora_usada_id'  : 'lavadora_usada_id';
    const precioCol  = esSecadora ? 'precio_secadora'    : 'precio_lavadora';
    const notaCol    = esSecadora ? 'secadora_id'        : 'maquina_id';

    // La carga que usa esa máquina.
    const { rows: cargaRows } = await client.query(
      `SELECT id, tipo_prenda FROM nota_cargas WHERE nota_id = $1 AND ${cargaCol} = $2 FOR UPDATE`,
      [id, maquina_actual_id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no está asignada a esta nota.' });
    }
    const carga = cargaRows[0];

    // La máquina nueva: disponible, del mismo tipo y en la sucursal.
    const { rows: nueRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_nueva_id, req.sucursal]
    );
    if (nueRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no existe.' });
    }
    const nueva = nueRows[0];
    if (nueva.estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${nueva.nombre} no está disponible.` });
    }
    if ((nueva.tipo === 'secadora') !== esSecadora) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Debes elegir una máquina del mismo tipo.' });
    }
    if (!esSecadora && String(carga.tipo_prenda).toUpperCase() === 'EDREDON' && nueva.tipo !== 'lavadora_jumbo') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
    }

    const t = await tarifasCarga(client);
    const precio = esSecadora
      ? tarifaSecadora(nueva.tamano, carga.tipo_prenda, t)
      : tarifaLavadora(nueva.tipo, carga.tipo_prenda, t);

    await client.query(
      `UPDATE nota_cargas SET ${cargaCol} = $1, ${usadaCol} = $1, ${precioCol} = $2 WHERE id = $3`,
      [maquina_nueva_id, precio, carga.id]
    );
    // Denormalización: si la nota apuntaba a la máquina vieja, apunta a la nueva.
    await client.query(
      `UPDATE notas SET ${notaCol} = $1 WHERE id = $2 AND ${notaCol} = $3`,
      [maquina_nueva_id, id, maquina_actual_id]
    );
    await recalcularPrecioTotal(client, id);

    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              m.tipo     AS maquina_tipo,
              m.estado   AS maquina_estado,
              m.en_uso_desde AS maquina_en_uso_desde,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/quitar-maquina ─────────────────────────
// Desasigna una máquina SIN INICIAR de su carga (para que ya no esté en la
// nota). Limpia su columna en la carga (viva y usada) y su precio. Si la carga
// queda sin máquinas y sin productos, se elimina. Recalcula el total. No aplica
// a máquinas en uso (primero hay que detenerlas).
export const quitarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_id } = req.body;

  if (!maquina_id) {
    return res.status(400).json({ message: 'maquina_id es requerido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede quitar una máquina de una nota finalizada o cancelada.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no existe.' });
    }
    if (maqRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo puedes quitar una máquina que aún no ha iniciado. Detén su ciclo primero.' });
    }
    const esSecadora  = maqRows[0].tipo === 'secadora';
    const cargaCol    = esSecadora ? 'secadora_id'       : 'lavadora_id';
    const precioCol   = esSecadora ? 'precio_secadora'   : 'precio_lavadora';
    const removidaCol = esSecadora ? 'secadora_removida' : 'lavadora_removida';
    const notaCol     = esSecadora ? 'secadora_id'       : 'maquina_id';

    const { rows: cargaRows } = await client.query(
      `SELECT id FROM nota_cargas WHERE nota_id = $1 AND ${cargaCol} = $2 FOR UPDATE`,
      [id, maquina_id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina no está asignada a esta nota.' });
    }
    const cargaId = cargaRows[0].id;

    // Se marca la máquina como ELIMINADA: se conserva su referencia usada (para
    // mostrar la línea tachada de "estuvo asignada"), se limpia la viva y su
    // precio, y se marca removida = TRUE. La carga NO se borra.
    await client.query(
      `UPDATE nota_cargas SET ${cargaCol} = NULL, ${precioCol} = 0, ${removidaCol} = TRUE WHERE id = $1`,
      [cargaId]
    );
    // Denormalización: si la nota apuntaba a esta máquina, dejar de apuntarla.
    await client.query(
      `UPDATE notas SET ${notaCol} = NULL WHERE id = $1 AND ${notaCol} = $2`,
      [id, maquina_id]
    );

    // Estado según máquinas en uso (la quitada no contaba); total recalculado.
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    await recalcularPrecioTotal(client, id);

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              m.nombre   AS maquina_nombre,
              m.tipo     AS maquina_tipo,
              m.estado   AS maquina_estado,
              m.en_uso_desde AS maquina_en_uso_desde,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('quitarMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-lavado ────────────────────────
// Termina el lavado de UNA lavadora de la nota y arranca su secado: libera
// esa lavadora, marca en uso la secadora elegida (obligatoria) y la asigna a
// las cargas que lavó esa lavadora. Cada carga es independiente: las demás
// lavadoras de la nota no se tocan. Cobra la tarifa de secado de esas cargas
// (el secado es un cargo aparte del lavado), así que el total sube. Si era la
// última lavadora la nota pasa a SECANDO, y a LISTA cuando su última secadora
// termina (ver terminarSecado).
export const terminarLavado = async (req, res) => {
  const { id } = req.params;
  const { lavadora_id, secadora_id } = req.body;

  if (!lavadora_id || !secadora_id) {
    return res.status(400).json({ message: 'lavadora_id y secadora_id son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, maquina_id FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (notaRows[0].estado !== 'LAVANDO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el lavado de una nota que está Lavando.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [secadora_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no existe.' });
    }
    if (maqRows[0].tipo !== 'secadora') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no es una secadora.' });
    }
    if (maqRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora seleccionada no está disponible.' });
    }
    const secadoraTamano = maqRows[0].tamano;

    // La lavadora debe pertenecer a la nota (cargas o columna legada).
    const { rows: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    const esLegada = String(notaRows[0].maquina_id) === String(lavadora_id);
    if (cargasLav.length === 0 && !esLegada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La lavadora no está asignada a esta nota.' });
    }

    // La secadora hereda las cargas de esa lavadora y cobra su tarifa de secado
    // según el TAMAÑO de la secadora (prenda edredón manda sobre el tamaño). Se
    // tarifa aquí porque en Autoservicio la carga nace solo con lavadora
    // (precio_secadora en 0) y el secado se cobra al iniciarlo.
    const t = await tarifasCarga(client);
    const { rows: cargasMover } = await client.query(
      `SELECT nc.id, nc.tipo_prenda
         FROM nota_cargas nc
        WHERE nc.nota_id = $1 AND nc.lavadora_id = $2 AND nc.secadora_id IS NULL
        FOR UPDATE OF nc`,
      [id, lavadora_id]
    );
    for (const c of cargasMover) {
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    // ...y la lavadora se desvincula y libera: queda libre para el siguiente
    // cliente y no debe re-liberarse (ni frenar el secado) si otra nota la
    // toma. El cobro del lavado ya quedó guardado en precio_lavadora.
    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // La secadora entra en uso y su ciclo arranca ahora. Se sella su ciclo
    // según la categoría de la carga (la lavadora que la lavó, ya en
    // lavadora_usada_id, define mediana/jumbo; la prenda, edredón).
    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    await sellarCicloMaquinas(client, id);
    // Denormalización: maquina_id apunta a alguna lavadora que siga en la
    // nota (o NULL si esta era la última); secadora_id, a la primera secadora.
    await client.query(
      `UPDATE notas
          SET maquina_id = (SELECT nc.lavadora_id FROM nota_cargas nc
                             WHERE nc.nota_id = $2 AND nc.lavadora_id IS NOT NULL
                             ORDER BY nc.orden ASC LIMIT 1),
              secadora_id = COALESCE(secadora_id, $1)
        WHERE id = $2`,
      [secadora_id, id]
    );
    // Si era la última lavadora, la nota pasa a SECANDO; si otras cargas
    // siguen en lavadora, continúa LAVANDO.
    const fase = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [fase, id]);

    // El secado recién cobrado sube el total; se recalcula y se valida que
    // ninguna carga rebase su tope.
    await recalcularPrecioTotal(client, id);
    const errTope = await validarTopesCargas(client, id);
    if (errTope) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: errTope });
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('terminarLavado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-secado ────────────────────────
// Termina el secado de UNA secadora de la nota: la libera y la desvincula.
// Si era la última máquina en uso de la nota, la nota pasa a LISTA
// ("Por Entregar"); si otras cargas siguen lavando o secando, la nota
// continúa en proceso.
export const terminarSecado = async (req, res) => {
  const { id } = req.params;
  const { secadora_id } = req.body;

  if (!secadora_id) {
    return res.status(400).json({ message: 'secadora_id es requerido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, secadora_id FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (!['LAVANDO', 'SECANDO'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el secado de una nota en proceso.' });
    }

    const { rowCount: cargasSec } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND secadora_id = $2 FOR UPDATE',
      [id, secadora_id]
    );
    const esLegada = String(notaRows[0].secadora_id) === String(secadora_id);
    if (cargasSec === 0 && !esLegada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La secadora no está asignada a esta nota.' });
    }

    // Desvincular y liberar la secadora: queda libre para el siguiente
    // cliente y no debe re-liberarse si otra nota la toma.
    await client.query(
      'UPDATE nota_cargas SET secadora_id = NULL WHERE nota_id = $1 AND secadora_id = $2',
      [id, secadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [secadora_id]
    );
    await client.query(
      `UPDATE notas
          SET secadora_id = (SELECT nc.secadora_id FROM nota_cargas nc
                              WHERE nc.nota_id = $1 AND nc.secadora_id IS NOT NULL
                              ORDER BY nc.orden ASC LIMIT 1)
        WHERE id = $1`,
      [id]
    );

    // ¿Era la última máquina de la nota? Entonces la nota está lista.
    const restantes = await maquinasDeNota(client, id);
    const { rowCount: enUso } = restantes.length === 0
      ? { rowCount: 0 }
      : await client.query(
          `SELECT id FROM maquinas WHERE id = ANY($1) AND estado = 'en_uso'`,
          [restantes]
        );
    if (enUso === 0) {
      await client.query(`UPDATE notas SET estado = 'LISTA' WHERE id = $1`, [id]);
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              u.nombre   AS usuario_nombre,
              s.nombre   AS secadora_nombre,
              s.tipo     AS secadora_tipo,
              s.estado   AS secadora_estado,
              s.en_uso_desde AS secadora_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  s ON s.id = n.secadora_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('terminarSecado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/estado-pago ────────────────────────────
export const cambiarEstadoPago = async (req, res) => {
  const { id } = req.params;
  const { estado_pago } = req.body;

  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT id, folio, estado, estado_pago FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const actual = notaRows[0];

    if (actual.estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No se puede cambiar el pago de una nota cancelada.' });
    }

    const esReversion = actual.estado_pago === 'PAGADO' && estado_pago === 'PENDIENTE';
    if (esReversion && !esAdmin(req.user.rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Solo un administrador puede revertir un pago.' });
    }

    const { rows } = await client.query(
      'UPDATE notas SET estado_pago = $1 WHERE id = $2 RETURNING *',
      [estado_pago, id]
    );
    if (esReversion) {
      await registrarReversionPago(client, actual, req.user.id, req.sucursal);
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('cambiarEstadoPago error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── GET /notas/:id/productos ────────────────────────────────
export const getNotaProductos = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
              (np.cantidad * np.precio_unitario) AS subtotal
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $2
       WHERE np.nota_id = $1
       ORDER BY np.created_at ASC`,
      [id, req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotaProductos error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /notas/:id/productos ───────────────────────────────
export const addProductoToNota = async (req, res) => {
  const { id } = req.params;
  const { producto_id, cantidad } = req.body;

  if (!producto_id || !cantidad || Number(cantidad) <= 0) {
    return res.status(400).json({ message: 'producto_id y cantidad (>0) son requeridos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se pueden agregar productos a una nota ${notaRows[0].estado}.`,
      });
    }

    const { rows: artRows } = await client.query(
      'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [producto_id, req.sucursal]
    );
    if (artRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    const art = artRows[0];
    const stockDisponible = art.stock_actual - art.stock_reservado;

    if (stockDisponible < Number(cantidad)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Stock insuficiente. Disponible: ${stockDisponible}, solicitado: ${cantidad}.`,
      });
    }

    const { rows: npRows } = await client.query(
      `INSERT INTO nota_productos (nota_id, producto_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, producto_id, cantidad, art.precio_unitario ?? 0]
    );

    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
      [cantidad, producto_id]
    );

    await recalcularPrecioTotal(client, id);

    await client.query('COMMIT');
    res.status(201).json(npRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('addProductoToNota error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── DELETE /notas/:id/productos/:productoId ─────────────────
export const removeProductoFromNota = async (req, res) => {
  const { id, productoId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: npRows } = await client.query(
      `SELECT np.*, n.estado AS nota_estado FROM nota_productos np
       JOIN notas n ON n.id = np.nota_id AND n.sucursal = $3
       WHERE np.nota_id = $1 AND np.producto_id = $2`,
      [id, productoId, req.sucursal]
    );
    if (npRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado en la nota.' });
    }
    const np = npRows[0];
    if (['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(np.nota_estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se pueden quitar productos de una nota ${np.nota_estado}.`,
      });
    }

    await client.query(
      'DELETE FROM nota_productos WHERE nota_id = $1 AND producto_id = $2',
      [id, productoId]
    );

    await client.query(
      'UPDATE productos SET stock_reservado = stock_reservado - $1 WHERE id = $2',
      [np.cantidad, productoId]
    );

    await recalcularPrecioTotal(client, id);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('removeProductoFromNota error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};
