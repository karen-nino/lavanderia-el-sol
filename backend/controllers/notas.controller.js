import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';
import { tarifaSecadora, precioProductoEnNota, unidadDeServicio, tapasPorUnidad, generarFolio } from '../utils/calculosNotas.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
const TIPOS_SERVICIO_VALIDOS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
// Formas de pago (mig. 078/090). Para el corte de caja solo EFECTIVO es dinero
// en el cajón; transferencia y tarjeta son cobros reales que no lo engrosan.
const FORMAS_PAGO_VALIDAS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'];

// Normaliza la forma de pago recibida; devuelve null si no es una válida.
const normalizarFormaPago = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return FORMAS_PAGO_VALIDAS.includes(s) ? s : null;
};
const TAMANOS_VALIDOS     = ['chico', 'grande', 'jumbo'];
const TIPOS_PRENDA_VALIDOS = ['ROPA', 'EDREDON'];
// Tipo de máquina previsto por carga en Por Encargo (define el precio; la
// máquina física real se asigna después en Salidas).
const TIPOS_MAQUINA_VALIDOS = ['mediana', 'jumbo', 'edredon'];
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

// Subconsulta con los IDs de todas las máquinas vinculadas a la nota `n`
// (las de sus cargas, tabla nota_cargas).
const SQL_MAQUINAS_DE_NOTA = `
  SELECT nc.lavadora_id AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT nc.secadora_id FROM nota_cargas nc WHERE nc.nota_id = n.id`;

// Fase de proceso de una nota según las máquinas EN USO ahora mismo: LAVANDO si
// alguna lavadora corre; si no, SECANDO si alguna secadora corre; y EN_ESPERA si
// no hay ninguna máquina en uso (todas asignadas pero sin iniciar, o ya
// detenidas). Solo cuentan las máquinas que ESTA nota arrancó (mig. 097): otra
// nota puede tener la misma asignada, y su ciclo no es el nuestro.
async function faseProcesoDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.lavadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
            AND nc.lavadora_iniciada_at IS NOT NULL
       ) AS lavando,
       EXISTS (
         SELECT 1 FROM nota_cargas nc JOIN maquinas m ON m.id = nc.secadora_id
          WHERE nc.nota_id = $1 AND m.estado = 'en_uso'
            AND nc.secadora_iniciada_at IS NOT NULL
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

// De la lista `ids`, devuelve las máquinas (id, nombre) que ya tiene apartadas
// OTRA nota abierta (En Espera / Lavando / Secando): asignadas a una carga o en
// las cargas de otra nota abierta. `notaIdExcluir` omite la nota en curso
// (edición/asignar). Se espera haber bloqueado antes las filas de maquinas
// (FOR UPDATE) para que dos asignaciones simultáneas de la misma máquina no se
// pisen.
// Nota que tiene una máquina EN USO ahora mismo, si no es la que se indica.
// Asignar una máquina no la aparta: varias notas pueden tenerla asignada
// mientras nadie la arranque. La primera que le da a "Iniciar" se la queda, y
// a partir de ahí las demás tienen que cambiarla. Sirve para decir en el aviso
// quién la está usando.
async function notaQueUsaMaquina(client, maquinaId, notaIdExcluir = null) {
  const { rows } = await client.query(
    `SELECT n.id, n.folio
       FROM notas n
      WHERE n.estado IN ('LAVANDO', 'SECANDO')
        AND ($2::int IS NULL OR n.id <> $2)
        AND EXISTS (
          SELECT 1 FROM nota_cargas nc
           WHERE nc.nota_id = n.id
             AND (nc.lavadora_id = $1 OR nc.secadora_id = $1)
        )
      ORDER BY n.created_at ASC
      LIMIT 1`,
    [maquinaId, notaIdExcluir]
  );
  return rows[0] ?? null;
}

// Marca en la carga que SUS máquinas arrancaron de verdad (mig. 097). Tener
// una máquina asignada ya no implica usarla: varias notas pueden tener la
// misma y solo la que le da a Iniciar la usa. Esta marca es la que distingue
// una cosa de la otra para liberar máquinas y para el reporte de uso.
async function marcarMaquinasIniciadas(client, notaId, maquinaIds) {
  if (!maquinaIds || maquinaIds.length === 0) return;
  await client.query(
    `UPDATE nota_cargas
        SET lavadora_iniciada_at = CASE WHEN lavadora_id = ANY($2) AND lavadora_iniciada_at IS NULL
                                        THEN NOW() ELSE lavadora_iniciada_at END,
            secadora_iniciada_at = CASE WHEN secadora_id = ANY($2) AND secadora_iniciada_at IS NULL
                                        THEN NOW() ELSE secadora_iniciada_at END
      WHERE nota_id = $1`,
    [notaId, maquinaIds.map(Number)]
  );
}

// Libera (pasa a disponible) las máquinas que ESTA nota arrancó y siguen en
// uso. Las que solo tiene asignadas no se tocan: pueden estar corriendo para
// otra nota que se le adelantó al iniciar, y apagarlas la dejaría a medias.
async function liberarMaquinasDeNota(client, notaId) {
  const { rows } = await client.query(
    `SELECT DISTINCT mid FROM (
       SELECT lavadora_id AS mid FROM nota_cargas
        WHERE nota_id = $1 AND lavadora_iniciada_at IS NOT NULL
       UNION
       SELECT secadora_id FROM nota_cargas
        WHERE nota_id = $1 AND secadora_iniciada_at IS NOT NULL
     ) x WHERE mid IS NOT NULL`,
    [notaId]
  );
  const ids = rows.map(r => r.mid);
  if (ids.length === 0) return;
  await client.query(
    `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
      WHERE id = ANY($1) AND estado = 'en_uso'`,
    [ids]
  );
}

// Recalcula precio_total de una nota.
//
// Precio cobrado por carga:
//   - Por Encargo CON tope: el precio ES el tope (precio fijo de la carga),
//     aunque el costo interno (máquinas + productos) sea menor. Los productos
//     de la carga quedan absorbidos en el tope (no se suman aparte).
//   - Por Encargo SIN tope, o Autoservicio: suma real = máquinas + productos
//     de la carga.
//   + el ajuste por carga (nota_cargas.ajuste), que va aparte del tope.
// Más: productos a nivel nota (carga_id NULL, Autoservicio) + ajuste de nota.
// Con `desmarcarPagoSiCambia`, una nota que ya estaba PAGADA vuelve a
// PENDIENTE si el cambio movió su total: lo que se cobró ya no corresponde a lo
// que cuesta la nota, así que el cobro se rehace por el importe nuevo. El
// trigger de la migración 037 limpia `pagado_en` al salir de PAGADO, con lo que
// la venta también sale del corte de caja hasta que se vuelva a cobrar.
// Si el total no se movió (por ejemplo, una máquina asignada "sin cobro"), el
// pago se respeta tal cual.
async function recalcularPrecioTotal(client, notaId, opciones = {}) {
  const { desmarcarPagoSiCambia = false, usuarioId = null, sucursal = null } = opciones;
  const { rows: previas } = desmarcarPagoSiCambia
    ? await client.query(
        'SELECT id, folio, precio_total, estado_pago FROM notas WHERE id = $1',
        [notaId]
      )
    : { rows: [] };
  const { rows } = await client.query(
    `UPDATE notas n
        SET precio_total =
          COALESCE((
            SELECT SUM(
              CASE
                WHEN n.tipo_servicio = 'POR_ENCARGO' AND carga.tope IS NOT NULL
                  THEN carga.tope
                ELSE carga.maquinas + carga.productos
              END
              + carga.ajuste)
            FROM (
              -- El tope es el que se congeló en la carga (mig. 096), no el
              -- vigente en Ajustes: cambiar los precios no re-tarifa notas
              -- viejas ni descuadra lo que ya se cobró.
              SELECT nc.ajuste, nc.precio_tope AS tope,
                     nc.precio_lavadora + nc.precio_secadora AS maquinas,
                     COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                                 FROM nota_productos np WHERE np.carga_id = nc.id), 0) AS productos
                FROM nota_cargas nc
               WHERE nc.nota_id = n.id
            ) carga
          ), 0)
          + COALESCE((SELECT SUM(np.cantidad * np.precio_unitario)
                        FROM nota_productos np
                       WHERE np.nota_id = n.id AND np.carga_id IS NULL), 0)
          + n.ajuste
      WHERE n.id = $1
      RETURNING precio_total`,
    [notaId]
  );
  const nuevo = rows[0]?.precio_total ?? null;

  const antes = previas[0];
  if (antes && antes.estado_pago === 'PAGADO' && Number(nuevo) !== Number(antes.precio_total)) {
    await desmarcarPagoPorCambio(client, antes, Number(antes.precio_total), Number(nuevo), usuarioId, sucursal);
  }
  return nuevo;
}

// Devuelve la nota a PENDIENTE porque su costo cambió: lo cobrado ya no
// corresponde. Limpia la forma de pago (el trigger de la mig. 037 limpia
// `pagado_en`) y deja aviso en la campana con los dos importes, para que se vea
// cuánto falta cobrar o devolver.
async function desmarcarPagoPorCambio(client, nota, antes, ahora, usuarioId, sucursal) {
  await client.query(
    "UPDATE notas SET estado_pago = 'PENDIENTE', forma_pago = NULL WHERE id = $1",
    [nota.id]
  );
  if (!sucursal) return;
  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  const etiqueta = nota.folio ?? `#${nota.id}`;
  const verbo = ahora > antes ? 'subió' : 'bajó';
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, usuario_id, sucursal)
     VALUES ('pago_desmarcado', $1, $2, $3)`,
    [`La nota ${etiqueta} ${verbo} de ${fmt(antes)} a ${fmt(ahora)} tras un cambio: quedó PENDIENTE de cobro`,
     usuarioId, sucursal]
  );
}


// Tarifas por carga desde ajustes (con los defaults de siempre).
async function tarifasCarga(client) {
  const { rows } = await client.query(
    `SELECT precio_carga_mediana, precio_carga_jumbo,
            precio_carga_secadora, precio_secadora_jumbo, precio_secadora_edredon,
            precio_edredon_jumbo,
            tope_carga_chico, tope_carga_grande, tope_carga_jumbo, tope_carga_edredon
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
    // Topes por tamaño de carga (Por Encargo). NULL = sin tope configurado.
    topeChico:       c.tope_carga_chico   != null ? Number(c.tope_carga_chico)   : null,
    topeGrande:      c.tope_carga_grande  != null ? Number(c.tope_carga_grande)  : null,
    topeJumbo:       c.tope_carga_jumbo   != null ? Number(c.tope_carga_jumbo)   : null,
    topeEdredon:     c.tope_carga_edredon != null ? Number(c.tope_carga_edredon) : null,
  };
}

// Tope vigente de una carga según su prenda y tamaño. En Por Encargo este tope
// ES el precio de la carga, así que se congela en `nota_cargas.precio_tope` al
// crearla (mig. 096): si el negocio cambia sus precios, las notas que ya
// existen conservan el suyo. NULL = sin tope (se cobra la suma de lo que lleva).
function topeDeCarga(prenda, tamano, t) {
  if (String(prenda ?? '').toUpperCase() === 'EDREDON') return t.topeEdredon;
  switch (tamano) {
    case 'chico':  return t.topeChico;
    case 'grande': return t.topeGrande;
    case 'jumbo':  return t.topeJumbo;
    default:       return null;
  }
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

// Sella maquinas.ciclo_minutos de TODAS las máquinas EN USO de la nota
// (lavadoras y secadoras) según la categoría de su carga. Necesario porque
// una misma máquina física (lavadora jumbo o cualquier secadora) puede tener
// distinta duración según lo que procesa: edredón vs. ropa jumbo vs. mediana.
//   Lavadora: prenda edredón (en jumbo) → edredonLavado; jumbo → jumbo; resto → mediana.
//   Secadora: tiempo único (la secadora es de un solo tamaño).
// Idempotente; se llama tras poner máquinas en uso en cualquier flujo.
// Solo se sella el ciclo de las máquinas que ESTA nota arrancó: otra nota
// puede tener la misma máquina asignada, y resellarle el ciclo le movería el
// temporizador a media lavada (mig. 097).
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
            AND nc.lavadora_iniciada_at IS NOT NULL
         UNION ALL
         -- Secadoras de la nota: tiempo de secado único (secadora sin tamaño).
         SELECT nc.secadora_id AS mid, $5::int AS minutos
           FROM nota_cargas nc
          WHERE nc.nota_id = $1 AND nc.secadora_id IS NOT NULL
            AND nc.secadora_iniciada_at IS NOT NULL
       ) ciclos
      WHERE m.id = ciclos.mid AND m.estado = 'en_uso'`,
    [notaId, ti.edredonLavado, ti.jumbo, ti.mediana, ti.secMediana]
  );
}

// Tope de precio por tamaño de carga (Ajustes): ninguna carga con tamaño
// puede rebasar su tope sumando lavadora + secadora + productos. El ajuste
// manual va aparte por decisión del negocio y NO cuenta contra el tope.
// Es tope duro para todos los roles (incluido admin); NULL en Ajustes =
// sin tope. Aplica SOLO a Servicio por Encargo (tipo de servicio POR_ENCARGO): el
// Autoservicio no captura tamaño y queda fuera; el filtro por tipo de servicio lo
// hace explícito además del tamaño. Se llama antes del COMMIT en cada ruta
// que pueda encarecer una carga (crear, editar, activar, asignar secadora).
// Devuelve el mensaje de error o null si todas las cargas caben.
async function validarTopesCargas(client, notaId) {
  const { rows } = await client.query(
    `SELECT nc.orden, nc.tamano,
            UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' AS es_edredon,
            nc.precio_lavadora + nc.precio_secadora AS maquinas,
            COALESCE(SUM(np.cantidad * np.precio_unitario), 0) AS productos,
            -- El tope congelado en la carga (mig. 096), que es su precio.
            nc.precio_tope AS tope
       FROM nota_cargas nc
       JOIN notas n ON n.id = nc.nota_id
       LEFT JOIN nota_productos np ON np.carga_id = nc.id
      WHERE nc.nota_id = $1 AND n.tipo_servicio = 'POR_ENCARGO'
        AND (nc.tamano IS NOT NULL OR UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON')
      GROUP BY nc.id
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
             `máquinas ${fmt(r.maquinas)} + productos y bolsa ${fmt(r.productos)} = ${fmt(total)}. ` +
             `Baja $${(total - Number(r.tope)).toFixed(2)}: quita algún producto o la bolsa.`;
    }
  }
  return null;
}

// Reserva un producto para una nota (o una carga): valida stock disponible,
// inserta la fila en nota_productos y aumenta stock_reservado. Lanza Error con
// el mensaje para el cliente si el producto no existe o no hay stock.
async function reservarProducto(client, notaId, cargaId, productoId, cantidad, sucursal, tipo_servicio) {
  const { rows: artRows } = await client.query(
    'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
    [productoId, sucursal]
  );
  if (artRows.length === 0) {
    throw new Error(`Producto ${productoId} no encontrado.`);
  }
  const art = artRows[0];
  // Bolsas: por pieza (precio por pieza). Líquidos: la unidad la define el
  // servicio — botella (Autoservicio) o tapa (Por Encargo).
  const esBolsa = art.clase === 'bolsa';
  const unidad = esBolsa ? 'pieza' : unidadDeServicio(tipo_servicio);
  const tpu = esBolsa ? 1 : tapasPorUnidad(art, unidad);
  const precioUnit = esBolsa ? (Number(art.precio_unitario) || 0) : precioProductoEnNota(art, tipo_servicio);
  const cantidadTapas = Number(cantidad) * tpu;
  const disponibleTapas = Number(art.stock_actual) - Number(art.stock_reservado);
  if (disponibleTapas < cantidadTapas) {
    const dispUnidad = unidad === 'botella' ? Math.floor(disponibleTapas / tpu) : disponibleTapas;
    // Nombre y unidad legibles para el aviso (la bolsa incluye su tamaño).
    const nombreArt = esBolsa && art.tamano_bolsa ? `Bolsa ${art.tamano_bolsa}` : art.nombre;
    const uni = esBolsa ? 'bolsa(s)' : unidad === 'botella' ? 'botella(s)' : 'tapa(s)';
    throw new Error(`No hay suficiente existencia de "${nombreArt}": quedan ${dispUnidad} ${uni} y se necesitan ${cantidad}. Carga más en Inventario o quítalo de la nota.`);
  }
  // Si el producto ya está en esta nota (y en la misma carga, si aplica) se le
  // suma la cantidad en vez de abrir otro renglón igual: así se puede pedir más
  // de lo mismo desde Salidas sin que la nota muestre el producto dos veces.
  const { rows: npRows } = await client.query(
    `INSERT INTO nota_productos (nota_id, carga_id, producto_id, cantidad, unidad, precio_unitario, cantidad_tapas)
          SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE NOT EXISTS (
                 SELECT 1 FROM nota_productos
                  WHERE nota_id = $1 AND producto_id = $3
                    AND carga_id IS NOT DISTINCT FROM $2)
     RETURNING *`,
    [notaId, cargaId, productoId, cantidad, unidad, precioUnit, cantidadTapas]
  );
  if (npRows.length === 0) {
    const { rows } = await client.query(
      `UPDATE nota_productos
          SET cantidad       = cantidad + $4,
              cantidad_tapas = cantidad_tapas + $5,
              precio_unitario = $6
        WHERE nota_id = $1 AND producto_id = $3 AND carga_id IS NOT DISTINCT FROM $2
     RETURNING *`,
      [notaId, cargaId, productoId, cantidad, cantidadTapas, precioUnit]
    );
    npRows.push(rows[0]);
  }
  await client.query(
    'UPDATE productos SET stock_reservado = stock_reservado + $1 WHERE id = $2',
    [cantidadTapas, productoId]
  );
  return { ...npRows[0], nombre: art.nombre, subtotal: Number(npRows[0].cantidad) * Number(npRows[0].precio_unitario) };
}

// Libera el stock reservado de los productos de una nota y los elimina.
async function liberarProductosDeNota(client, notaId) {
  await client.query(
    `UPDATE productos a
        SET stock_reservado = stock_reservado - np.cantidad_tapas
      FROM nota_productos np
      WHERE np.nota_id = $1 AND np.producto_id = a.id`,
    [notaId]
  );
  await client.query('DELETE FROM nota_productos WHERE nota_id = $1', [notaId]);
}

// Registra en el historial de inventario los movimientos de los productos de una
// nota: 'venta' cuando se consume el stock (pago/entrega) o 'liberacion' cuando
// se devuelve al anular una venta. Una fila por producto de la nota.
async function registrarMovimientosProductosNota(client, notaId, sucursal, usuarioId, tipo) {
  await client.query(
    `INSERT INTO producto_movimientos
       (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, descripcion, nota_id)
     SELECT np.producto_id, $2, $3, $4,
            (CASE WHEN a.clase = 'bolsa' THEN 'piezas' ELSE 'botellas' END),
            np.cantidad_tapas,
            np.cantidad || (CASE
                              WHEN np.unidad = 'pieza' THEN ' bolsa(s)'
                              WHEN np.unidad = 'botella'
                                THEN (CASE WHEN a.tipo_liquido = 'marca' THEN ' unidad(es)' ELSE ' botella(s)' END)
                              ELSE ' tapa(s)' END),
            np.nota_id
       FROM nota_productos np
       JOIN productos a ON a.id = np.producto_id
      WHERE np.nota_id = $1`,
    [notaId, sucursal, usuarioId ?? null, tipo]
  );
}

// Valida y tarifica las cargas recibidas en el body. Cada carga puede traer:
//   { lavadora_id, secadora_id, tipo_prenda, tipo_tela, tamano_edredon,
//     tamano, ajuste, productos: [{ producto_id, cantidad }] }
// (todo opcional salvo que el tipo de servicio lo exija). Devuelve las filas listas
// para insertar o lanza un Error con el mensaje para el cliente.
async function prepararCargas(client, cargas, tipoPrendaNota, sucursal, tipo_servicio) {
  if (!Array.isArray(cargas) || cargas.length === 0) {
    throw new Error('cargas debe ser una lista con al menos una carga.');
  }
  if (cargas.length > 20) {
    throw new Error('Máximo 20 cargas por nota.');
  }
  // Por Encargo y Autoservicio: la carga elige TIPO de máquina (no máquina
  // física), así que no se buscan ni validan máquinas por id (se asignan luego
  // en Salidas). Solo el legado EDREDON usa máquina específica.
  const esPorEncargo = tipo_servicio === 'POR_ENCARGO' || tipo_servicio === 'AUTOSERVICIO';
  const ids = esPorEncargo ? [] : [...new Set(
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
    const prendaCarga = (c.tipo_prenda ? String(c.tipo_prenda).toUpperCase() : tipoPrendaNota) || 'ROPA';
    if (c.tipo_prenda && !TIPOS_PRENDA_VALIDOS.includes(prendaCarga)) {
      throw new Error(`tipo_prenda inválido en la carga ${i + 1}.`);
    }
    if (c.tamano && !TAMANOS_VALIDOS.includes(String(c.tamano).toLowerCase())) {
      throw new Error(`tamano inválido en la carga ${i + 1}.`);
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

    // Por Encargo: la carga elige TIPO de máquina (no máquina física). El precio
    // se deriva del tipo; lavadora_id/secadora_id quedan NULL hasta asignar en
    // Salidas. La nota nace En Espera (activar=false, no hay máquina que iniciar).
    let lavadoraId = null, secadoraId = null, lavadoraTipo = null, secadoraTipo = null;
    let precioLavadora = 0, precioSecadora = 0, activar;
    if (esPorEncargo) {
      lavadoraTipo = c.lavadora_tipo ? String(c.lavadora_tipo).toLowerCase() : null;
      secadoraTipo = c.secadora_tipo ? String(c.secadora_tipo).toLowerCase() : null;
      if (lavadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(lavadoraTipo)) {
        throw new Error(`Tipo de lavadora inválido en la carga ${i + 1}.`);
      }
      if (secadoraTipo && !TIPOS_MAQUINA_VALIDOS.includes(secadoraTipo)) {
        throw new Error(`Tipo de secadora inválido en la carga ${i + 1}.`);
      }
      if (prendaCarga === 'EDREDON' && lavadoraTipo && lavadoraTipo !== 'jumbo') {
        throw new Error(`Los edredones solo van en lavadora jumbo (carga ${i + 1}).`);
      }
      if (!lavadoraTipo && !secadoraTipo) {
        throw new Error(`La carga ${i + 1} necesita al menos un tipo de lavado o secado.`);
      }
      if (lavadoraTipo) {
        precioLavadora = tarifaLavadora(lavadoraTipo === 'jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana', prendaCarga, t);
      }
      if (secadoraTipo) {
        precioSecadora = tarifaSecadora(secadoraTipo, prendaCarga, t);
      }
      activar = false;
    } else {
      // Servicio legado EDREDON: es el único que sigue eligiendo la máquina
      // física al crear la nota (Autoservicio y Por Encargo eligen tipo y la
      // asignan después en Salidas).
      lavadoraId = c.lavadora_id ? Number(c.lavadora_id) : null;
      secadoraId = c.secadora_id ? Number(c.secadora_id) : null;
      if (lavadoraId && tipoPorId.get(lavadoraId) === 'secadora') {
        throw new Error(`La máquina de lavado de la carga ${i + 1} es una secadora.`);
      }
      if (secadoraId && tipoPorId.get(secadoraId) !== 'secadora') {
        throw new Error(`La máquina de secado de la carga ${i + 1} no es una secadora.`);
      }
      if (prendaCarga === 'EDREDON' && lavadoraId && tipoPorId.get(lavadoraId) !== 'lavadora_jumbo') {
        throw new Error(`Los edredones solo van en lavadora jumbo (carga ${i + 1}).`);
      }
      precioLavadora = lavadoraId ? tarifaLavadora(tipoPorId.get(lavadoraId), prendaCarga, t) : 0;
      precioSecadora = secadoraId ? tarifaSecadora(tamanoPorId.get(secadoraId), prendaCarga, t) : 0;
      // Autoservicio arranca de inmediato; cada carga puede decidir con `activar`.
      activar = c.activar !== false;
    }

    return {
      orden:           i + 1,
      lavadora_id:     lavadoraId,
      secadora_id:     secadoraId,
      lavadora_tipo:   lavadoraTipo,
      secadora_tipo:   secadoraTipo,
      precio_lavadora: precioLavadora,
      precio_secadora: precioSecadora,
      tipo_prenda:     c.tipo_prenda ? prendaCarga : null,
      tipo_tela:       prendaCarga === 'ROPA' && c.tipo_tela ? String(c.tipo_tela).trim() : null,
      tamano_edredon:  prendaCarga === 'EDREDON' && c.tamano_edredon ? String(c.tamano_edredon).trim() : null,
      tamano:          c.tamano ? String(c.tamano).toLowerCase() : null,
      ajuste:          ajusteCarga,
      // Precio de la carga en Por Encargo: el tope vigente de su tamaño, que se
      // congela aquí (mig. 096). Editar las cargas de una nota las vuelve a
      // tarifar con los precios de hoy, igual que a sus máquinas.
      precio_tope:     tipo_servicio === 'POR_ENCARGO'
        ? topeDeCarga(prendaCarga, c.tamano ? String(c.tamano).toLowerCase() : null, t)
        : null,
      activar,
      productos,
    };
  });
}

// Inserta las filas de nota_cargas ya preparadas (con sus productos, que
// reservan stock). Devuelve las cargas con sus productos.
async function insertarCargas(client, notaId, filas, sucursal, tipo_servicio) {
  const insertadas = [];
  for (const f of filas) {
    const { rows } = await client.query(
      `INSERT INTO nota_cargas
         (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
          lavadora_tipo, secadora_tipo, precio_lavadora, precio_secadora,
          tipo_prenda, tipo_tela, tamano_edredon, tamano, ajuste, precio_tope)
       VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [notaId, f.orden, f.lavadora_id, f.secadora_id, f.lavadora_tipo, f.secadora_tipo,
       f.precio_lavadora, f.precio_secadora,
       f.tipo_prenda, f.tipo_tela, f.tamano_edredon, f.tamano, f.ajuste,
       f.precio_tope ?? null]
    );
    const carga = rows[0];
    const productos = [];
    for (const p of (f.productos ?? [])) {
      productos.push(await reservarProducto(client, notaId, carga.id, p.producto_id, p.cantidad, sucursal, tipo_servicio));
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
            nc.lavadora_tipo AS lavadora_tipo_previsto,
            nc.secadora_tipo AS secadora_tipo_previsto,
            ml.nombre AS lavadora_nombre, ml.tipo AS lavadora_tipo, ml.estado AS lavadora_estado,
            ml.en_uso_desde AS lavadora_en_uso_desde,
            ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo, ms.estado AS secadora_estado,
            ms.tamano AS secadora_tamano, ms.en_uso_desde AS secadora_en_uso_desde,
            nc.lavadora_usada_id, nc.secadora_usada_id,
            nc.lavadora_removida, nc.secadora_removida,
            mlu.nombre AS lavadora_usada_nombre, mlu.tipo AS lavadora_usada_tipo,
            msu.nombre AS secadora_usada_nombre, msu.tipo AS secadora_usada_tipo,
            msu.tamano AS secadora_usada_tamano,
            -- Tope CONGELADO de la carga (mig. 096). En Por Encargo el tope ES
            -- el precio que se cobra por la carga, y es el que ve el ticket;
            -- NULL = sin tope, la carga se cobra por lo que lleva dentro.
            nc.precio_tope AS tope_carga
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
    `SELECT np.id, np.carga_id, np.producto_id, a.nombre, np.cantidad, np.unidad, np.precio_unitario,
            a.es_por_tapa, a.tipo_liquido, a.clase, a.tamano_bolsa, a.marca,
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
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
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
async function registrarCancelacionNota(client, nota, usuarioId, sucursal, motivo = null) {
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un empleado';
  const folio = nota.folio ?? `#${nota.id}`;
  const mensaje = `Nota ${folio} cancelada por ${quien}${motivo ? `: ${motivo}` : ''}`;
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, nota_folio, usuario_id, sucursal)
     VALUES ('nota_cancelada', $1, $2, $3, $4)`,
    [mensaje, folio, usuarioId, sucursal]
  );
}

// Deja rastro en la campana del Dashboard cuando se elimina una nota: borra el
// registro por completo, así que siempre queda constancia de quién la eliminó y
// qué nota era.
async function registrarEliminacionNota(client, nota, usuarioId, sucursal) {
  const { rows } = await client.query("SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1", [usuarioId]);
  const quien = rows[0]?.nombre ?? 'un administrador';
  const folio = nota.folio ?? `#${nota.id}`;
  await client.query(
    `INSERT INTO notificaciones (tipo, mensaje, nota_folio, usuario_id, sucursal)
     VALUES ('nota_eliminada', $1, $2, $3, $4)`,
    [`Nota ${folio} eliminada por ${quien}`, folio, usuarioId, sucursal]
  );
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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              su.nombre  AS sucursal_nombre,
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
                 ) xm
                 JOIN maquinas mm ON mm.id = xm.mid) AS maquinas_nombres,
              -- Fases vivas de la nota: si tiene lavadora(s) y/o secadora(s)
              -- realmente EN USO ahora mismo (no solo asignadas: una máquina
              -- asignada pero sin iniciar no cuenta). Con varias cargas puede
              -- tener ambas a la vez (una lavando, otra secando).
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ml ON ml.id = nc.lavadora_id
                       WHERE nc.nota_id = n.id AND ml.estado = 'en_uso'
                         AND nc.lavadora_iniciada_at IS NOT NULL) AS hay_lavadora_activa,
              EXISTS (SELECT 1 FROM nota_cargas nc JOIN maquinas ms ON ms.id = nc.secadora_id
                       WHERE nc.nota_id = n.id AND ms.estado = 'en_uso'
                         AND nc.secadora_iniciada_at IS NOT NULL) AS hay_secadora_activa
       FROM notas n
       LEFT JOIN clientes   c  ON c.id = n.cliente_id
       JOIN      usuarios   u  ON u.id = n.usuario_id
       LEFT JOIN sucursales su ON su.slug = n.sucursal
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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              su.nombre  AS sucursal_nombre
       FROM notas n
       LEFT JOIN clientes   c  ON c.id = n.cliente_id
       JOIN      usuarios   u  ON u.id = n.usuario_id
       LEFT JOIN sucursales su ON su.slug = n.sucursal
       WHERE n.id = $1 AND n.sucursal = $2`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const { rows: productos } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.unidad, np.precio_unitario,
              a.es_por_tapa, a.tipo_liquido, a.clase, a.tamano_bolsa, a.marca,
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
    tipo_servicio = 'POR_ENCARGO',
    tipo_prenda = 'ROPA',
    estado_pago,
    forma_pago,
    peso_kg,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    tamano,
    tipo_tela,
    tamano_edredon,
    ajuste = 0,
    cargas,         // [{ lavadora_id, secadora_id, activar, ... }] por carga
    insumos   = [], // [{ insumo_id, cantidad }]  → movimientos_insumos
    productos = [], // [{ producto_id, cantidad }] → nota_productos
  } = req.body;

  if (!TIPOS_SERVICIO_VALIDOS.includes(tipo_servicio)) {
    return res.status(400).json({
      message: `Tipo de servicio inválido. Valores permitidos: ${TIPOS_SERVICIO_VALIDOS.join(', ')}.`,
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
  if (tipo_servicio === 'POR_ENCARGO' && !cliente_id) {
    return res.status(400).json({ message: 'Elige el cliente: las notas Por Encargo llevan cliente.' });
  }
  // Modelo por cargas: toda nota trae sus cargas, cada una con sus máquinas y
  // —en encargo— su prenda, tela/tamaño, ajuste y productos.
  if (!Array.isArray(cargas) || cargas.length === 0) {
    return res.status(400).json({ message: 'La nota necesita al menos una carga.' });
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `tiempo_entrega inválido. Valores permitidos: ${TIEMPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }
  // El ajuste puede ser negativo (descuento); el total final de la nota no,
  // lo que se verifica antes del COMMIT ya con los productos sumados.
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'ajuste debe ser numérico.' });
  }

  // El cliente referenciado debe pertenecer a la sucursal activa (las máquinas
  // se validan por carga en prepararCargas).
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'El cliente seleccionado no existe en esta sucursal.' });
  }

  const ajusteNum = Number(ajuste) || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Se validan y tarifican las cargas primero; de ellas sale el total.
    let filasCargas;
    try {
      filasCargas = await prepararCargas(client, cargas, tipo_prenda, req.sucursal, tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }
    // Cada carga (Autoservicio y Por Encargo) exige al menos un tipo de lavado o
    // secado; eso lo valida prepararCargas. Aquí ya no se exige máquina física.
    const cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);

    // Ninguna máquina de la nota puede estar ya apartada por otra nota abierta
    // (aunque nazca En Espera). Se bloquean las filas y se valida para que dos
    // notas no tomen la misma máquina.
    const idsMaquinasNota = [...new Set(filasCargas.flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];

    // Máquinas a tomar al crear: solo las de las cargas que se activan. Si
    // ninguna se activa, la nota nace En Espera (las máquinas quedan asignadas
    // pero libres, para activarse luego desde Salidas).
    const idsActivar = [...new Set(filasCargas.filter(f => f.activar).flatMap(f => [f.lavadora_id, f.secadora_id]).filter(Boolean))];
    const estadoNota = idsActivar.length > 0
      ? (filasCargas.some(f => f.activar && f.lavadora_id) ? 'LAVANDO' : 'SECANDO')
      : 'EN_ESPERA';

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, tipo_servicio, tipo_prenda, estado, estado_pago, sucursal,
          peso_kg, precio_total, fecha_entrega, tiempo_entrega, instrucciones,
          tamano, tipo_tela, tamano_edredon, ajuste, forma_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        tipo_servicio,
        String(tipo_prenda).toUpperCase(),
        estadoNota,
        estado_pago,
        req.sucursal,
        peso_kg      || null,
        cargasSum + ajusteNum,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        instrucciones || null,
        tamano ? String(tamano).toLowerCase() : null,
        tipo_tela ? String(tipo_tela).trim() : null,
        tamano_edredon ? String(tamano_edredon).trim() : null,
        ajusteNum,
        // Forma de pago solo con pago anticipado (PAGADO); si no, null.
        estado_pago === 'PAGADO' ? normalizarFormaPago(forma_pago) : null,
      ]
    );
    const nota = notaRows[0];

    const folio = generarFolio(nota.id, nota.created_at);
    await client.query('UPDATE notas SET folio = $1 WHERE id = $2', [folio, nota.id]);
    nota.folio = folio;

    // Insertar las cargas y tomar las máquinas de las cargas activadas. Reservar
    // los productos de una carga puede fallar (p. ej. sin existencia de una bolsa):
    // se responde con el mensaje claro (400), no un 500.
    let cargasInsertadas;
    try {
      cargasInsertadas = await insertarCargas(client, nota.id, filasCargas, req.sucursal, tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }
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
      await marcarMaquinasIniciadas(client, nota.id, idsActivar);
      await sellarCicloMaquinas(client, nota.id);
    }

    if (tipo_servicio === 'POR_ENCARGO' || tipo_servicio === 'AUTOSERVICIO') {
      for (const { insumo_id, cantidad } of insumos) {
        if (!insumo_id || !cantidad || cantidad <= 0) continue;

        const { rows: stockRows } = await client.query(
          'SELECT stock_actual FROM insumos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
          [insumo_id, req.sucursal]
        );
        if (stockRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'El insumo seleccionado no existe en esta sucursal.' });
        }
        if (Number(stockRows[0].stock_actual) < cantidad) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'No hay existencia suficiente de ese insumo.' });
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
    // (nivel nota, carga_id NULL). La unidad/precio/tapas los resuelve
    // reservarProducto según el servicio (botella en Autoservicio, tapa en Por Encargo).
    const productosInsertados = [];
    for (const { producto_id, cantidad } of productos) {
      if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;
      try {
        productosInsertados.push(
          await reservarProducto(client, nota.id, null, producto_id, cantidad, req.sucursal, tipo_servicio)
        );
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
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
      return res.status(400).json({ message: 'El cliente o la máquina seleccionada no existe en esta sucursal.' });
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
    estado_pago,
    forma_pago,
    fecha_entrega,
    tiempo_entrega,
    instrucciones,
    tamano,
    tipo_prenda,
    tipo_tela,
    tamano_edredon,
    ajuste,
    cargas,
    productos,
  } = req.body;

  if (productos !== undefined && !Array.isArray(productos)) {
    return res.status(400).json({ message: 'productos debe ser una lista.' });
  }
  if (cargas !== undefined && (!Array.isArray(cargas) || cargas.length === 0)) {
    return res.status(400).json({ message: 'La nota necesita al menos una carga.' });
  }
  if (ajuste != null && ajuste !== '' && !Number.isFinite(Number(ajuste))) {
    return res.status(400).json({ message: 'ajuste debe ser numérico.' });
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

  // El cliente referenciado debe pertenecer a la sucursal activa (las máquinas
  // se validan por carga en prepararCargas).
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'El cliente seleccionado no existe en esta sucursal.' });
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

    // Cobrar desde la edición exige la forma de pago igual que el endpoint
    // dedicado; si no, la nota quedaría cobrada sin saber si el dinero entró
    // al cajón. Editar una nota YA pagada sin mandarla conserva la que tenía.
    const esCobroNuevo = estado_pago === 'PAGADO' && actual.estado_pago !== 'PAGADO';
    const formaPagoNueva = normalizarFormaPago(forma_pago);
    if (esCobroNuevo && !formaPagoNueva) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Indica la forma de pago. Valores permitidos: ${FORMAS_PAGO_VALIDAS.join(', ')}.`,
      });
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
        filasCargas = await prepararCargas(client, cargas, prendaEfectiva, req.sucursal, actual.tipo_servicio);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }
      // Liberar el stock reservado de los productos de las cargas viejas antes
      // de borrarlas (el ON DELETE CASCADE elimina las filas pero no revierte
      // stock_reservado). Los nuevos productos se reservan en insertarCargas.
      await client.query(
        `UPDATE productos a
            SET stock_reservado = stock_reservado - np.cantidad_tapas
          FROM nota_productos np
          WHERE np.nota_id = $1 AND np.carga_id IS NOT NULL AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_cargas WHERE nota_id = $1', [id]);
      try {
        cargasNota = await insertarCargas(client, id, filasCargas, req.sucursal, actual.tipo_servicio);
      } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: e.message });
      }

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
          await marcarMaquinasIniciadas(client, id, tomar);
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

    // Los productos solo se tocan si vienen en el body: la lista enviada
    // (aun vacía) reemplaza los de la nota; ausente, se conservan.
    let productosNota;
    if (productos !== undefined) {
      // Solo los productos a nivel nota (carga_id IS NULL, autoservicio); los
      // de cargas se manejan junto con sus cargas.
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad_tapas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.carga_id IS NULL AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_productos WHERE nota_id = $1 AND carga_id IS NULL', [id]);

      // Insertar los nuevos productos (nivel nota). La unidad/precio/tapas los
      // resuelve reservarProducto según el servicio.
      const productosInsertados = [];
      for (const { producto_id, cantidad } of productos) {
        if (!producto_id || !cantidad || Number(cantidad) <= 0) continue;
        try {
          productosInsertados.push(
            await reservarProducto(client, id, null, producto_id, cantidad, req.sucursal, actual.tipo_servicio)
          );
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: e.message });
        }
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
    let cargasSum;
    if (filasCargas) {
      cargasSum = filasCargas.reduce((s, f) => s + f.precio_lavadora + f.precio_secadora, 0);
    } else {
      const { rows: sumRows } = await client.query(
        'SELECT SUM(precio_lavadora + precio_secadora) AS s FROM nota_cargas WHERE nota_id = $1',
        [id]
      );
      cargasSum = sumRows[0]?.s != null ? Number(sumRows[0].s) : 0;
    }

    // Provisional: recalcularPrecioTotal (abajo) fija el definitivo con la
    // regla de tope (en Por Encargo el precio de la carga es su tope).
    const subtotalProductos = productosNota.reduce((s, p) => s + Number(p.subtotal), 0);
    const precioFinal = cargasSum + ajusteNum + subtotalProductos;

    const { rows } = await client.query(
      `UPDATE notas SET
         cliente_id      = $2,
         estado_pago     = $3,
         fecha_entrega   = $4,
         tiempo_entrega  = $5,
         instrucciones   = $6,
         tamano          = $7,
         tipo_prenda     = $8,
         tipo_tela       = $9,
         tamano_edredon  = $10,
         ajuste          = $11,
         precio_total    = $12,
         forma_pago      = $13
       WHERE id = $1
       RETURNING *`,
      [
        id,
        tiene('cliente_id')     ? (cliente_id || null) : actual.cliente_id,
        estado_pago || actual.estado_pago,
        tiene('fecha_entrega')  ? (fecha_entrega || null) : actual.fecha_entrega,
        tiene('tiempo_entrega') ? (tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null) : actual.tiempo_entrega,
        tiene('instrucciones')  ? (instrucciones || null) : actual.instrucciones,
        tamano ? String(tamano).toLowerCase() : actual.tamano,
        tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda,
        tiene('tipo_tela')      ? (tipo_tela ? String(tipo_tela).trim() : null) : actual.tipo_tela,
        tiene('tamano_edredon') ? (tamano_edredon ? String(tamano_edredon).trim() : null) : actual.tamano_edredon,
        ajusteNum,
        precioFinal,
        // Cobro nuevo → la forma recibida. Reversión → se limpia. En cualquier
        // otro caso se conserva la que ya tenía la nota.
        esCobroNuevo ? formaPagoNueva : (esReversionPago ? null : actual.forma_pago),
      ]
    );

    // Total definitivo con la regla de tope (precio fijo por carga en Por
    // Encargo). Sobrescribe el provisional de arriba.
    rows[0].precio_total = await recalcularPrecioTotal(client, id);

    // Si la edición movió el total de una nota que ya estaba pagada, el cobro
    // deja de corresponder y vuelve a PENDIENTE. Se compara contra el precio
    // que tenía ANTES de editar (no contra el provisional). No aplica si en
    // esta misma petición se está cobrando o revirtiendo el pago a mano.
    if (actual.estado_pago === 'PAGADO' && !esCobroNuevo && !esReversionPago
        && Number(rows[0].precio_total) !== Number(actual.precio_total)) {
      await desmarcarPagoPorCambio(
        client, actual, Number(actual.precio_total), Number(rows[0].precio_total),
        req.user?.id, req.sucursal
      );
      rows[0].estado_pago = 'PENDIENTE';
      rows[0].forma_pago  = null;
      rows[0].pagado_en   = null;
    }

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
      return res.status(400).json({ message: 'El cliente o la máquina seleccionada no existe en esta sucursal.' });
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
    // Solo las que ESTA nota arrancó: las que únicamente tenía asignadas
    // pueden estar corriendo para otra nota (mig. 097).
    const { rows: iniciadasRows } = await client.query(
      `SELECT DISTINCT mid FROM (
         SELECT lavadora_id AS mid FROM nota_cargas
          WHERE nota_id = $1 AND lavadora_iniciada_at IS NOT NULL
         UNION
         SELECT secadora_id FROM nota_cargas
          WHERE nota_id = $1 AND secadora_iniciada_at IS NOT NULL
       ) x WHERE mid IS NOT NULL`,
      [id]
    );
    const maquinasNota = iniciadasRows.map(r => r.mid);

    // El efecto en stock depende del estado de la nota:
    //   - PAGADA: el pago ya consumió stock_actual y liberó la reserva;
    //     eliminar anula la venta y el producto vuelve al estante.
    //   - FINALIZADA / CANCELADA: el stock ya se consumió o la reserva ya
    //     se liberó; no hay nada que revertir.
    //   - Estados activos: solo liberar la reserva.
    if (estadoNota === 'PAGADA') {
      await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'liberacion');
      await client.query(
        `UPDATE productos a
           SET stock_actual = stock_actual + np.cantidad_tapas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    } else if (!['FINALIZADA', 'CANCELADA'].includes(estadoNota)) {
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad_tapas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    await client.query('DELETE FROM notas WHERE id = $1', [id]);

    // Liberar las máquinas que esta nota tenía corriendo
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
      'SELECT estado, estado_pago FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // No se puede finalizar (entregar) una nota pendiente de pago: primero se
    // liquida. La UI muestra el botón "Liquidar" en vez de "Finalizar".
    if (estado === 'FINALIZADA' && notaRows[0].estado_pago === 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'No se puede finalizar una nota pendiente de pago. Liquídala primero.',
      });
    }

    if (estado === 'CANCELADA') {
      if (estadoActual === 'PAGADA') {
        // El pago ya consumió stock_actual y liberó la reserva; al anular
        // la venta el producto vuelve al estante.
        await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'liberacion');
        await client.query(
          `UPDATE productos a
             SET stock_actual = stock_actual + np.cantidad_tapas
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      } else {
        await client.query(
          `UPDATE productos a
             SET stock_reservado = stock_reservado - np.cantidad_tapas
           FROM nota_productos np
           WHERE np.nota_id = $1 AND np.producto_id = a.id`,
          [id]
        );
      }
    } else if (estado === 'PAGADA' || (estado === 'FINALIZADA' && estadoActual !== 'PAGADA')) {
      // Consumir stock al cobrar o al entregar, lo que ocurra primero.
      // (PAGADA → FINALIZADA no vuelve a consumir.)
      await registrarMovimientosProductosNota(client, id, req.sucursal, req.user.id, 'venta');
      await client.query(
        `UPDATE productos a
           SET stock_actual    = stock_actual    - np.cantidad_tapas,
               stock_reservado = stock_reservado - np.cantidad_tapas
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    }

    // Al cancelar se guarda el motivo (opcional) capturado por el empleado.
    const motivoCancel = estado === 'CANCELADA'
      ? (typeof req.body?.motivo === 'string' ? req.body.motivo.trim() || null : null)
      : null;
    const { rows } = await client.query(
      `UPDATE notas SET estado = $1${estado === 'CANCELADA' ? ', motivo_cancelacion = $3' : ''} WHERE id = $2 RETURNING *`,
      estado === 'CANCELADA' ? [estado, id, motivoCancel] : [estado, id]
    );

    // Al terminar el ciclo (Por Entregar) o cancelar, la nota suelta todas
    // sus máquinas. El backend es el dueño del ciclo de vida: los clientes
    // ya no necesitan liberar máquina por máquina.
    if (estado === 'LISTA' || estado === 'CANCELADA') {
      await liberarMaquinasDeNota(client, id);
    }

    // Alerta en la campana del Dashboard cuando se cancela una nota.
    if (estado === 'CANCELADA') {
      await registrarCancelacionNota(client, rows[0], req.user.id, req.sucursal, motivoCancel);
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

    // Con maquina_id se activa solo esa (botón por máquina); debe estar
    // asignada a la nota y libre. Aquí es donde se decide quién se queda con
    // una máquina que varias notas tienen asignada: la primera en iniciar. El
    // FOR UPDATE de arriba serializa a dos empleados que le den a la vez.
    if (maquina_id != null) {
      if (!libres.some(x => String(x) === String(maquina_id))) {
        const asignada = maqs.some(m => String(m.id) === String(maquina_id));
        const ocupada = maqs.find(m => String(m.id) === String(maquina_id) && m.estado === 'en_uso');
        let mensaje = 'La máquina no está asignada a la nota o no está disponible.';
        if (ocupada) {
          // La tomó alguien más: hay que cambiarla por otra en esta carga.
          const duena = await notaQueUsaMaquina(client, Number(maquina_id), Number(id));
          const { rows: nomRows } = await client.query('SELECT nombre FROM maquinas WHERE id = $1', [maquina_id]);
          const nombre = nomRows[0]?.nombre ?? 'La máquina';
          mensaje = duena
            ? `${nombre} ya la está usando la nota ${duena.folio ?? `#${duena.id}`}. Cámbiala por otra en esta carga.`
            : `${nombre} ya está en uso. Cámbiala por otra en esta carga.`;
        } else if (!asignada) {
          mensaje = 'La máquina no está asignada a esta nota.';
        }
        await client.query('ROLLBACK');
        return res.status(409).json({ message: mensaje });
      }
      libres = [Number(maquina_id)];
    }

    if (libres.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No hay máquinas pendientes por activar.' });
    }

    // Al iniciar el secado de una carga cuya lavadora seguía lavando (en uso),
    // esa lavadora ya cumplió: se captura antes de tomar la secadora para
    // soltarla (desvincular + liberar) después. La carga conserva la lavadora
    // en lavadora_usada_id (historial). Solo aplica a lavadoras realmente en uso.
    const { rows: lavASoltar } = await client.query(
      `SELECT nc.id AS carga_id, nc.lavadora_id
         FROM nota_cargas nc
         JOIN maquinas ml ON ml.id = nc.lavadora_id
        WHERE nc.nota_id = $1 AND nc.secadora_id = ANY($2) AND ml.estado = 'en_uso'
          AND nc.lavadora_iniciada_at IS NOT NULL`,
      [id, libres]
    );

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
      [libres]
    );
    await marcarMaquinasIniciadas(client, id, libres);

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
      `SELECT n.* FROM notas n WHERE n.id = $1`,
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

// ── PATCH /notas/:id/asignar-carga-maquina ──────────────────
// Asigna una máquina física a una carga (de Autoservicio o Por Encargo) creada
// con TIPO pero sin máquina. Valida que coincida con el tipo previsto del slot,
// que esté disponible y que no la tenga apartada otra nota abierta. La máquina
// queda asignada En Espera (se arranca luego con "Iniciar").
// El precio ya está fijado por el tipo: NO se recalcula.
export const asignarCargaMaquina = async (req, res) => {
  const { id } = req.params;
  const { carga_id, slot, maquina_id } = req.body; // slot: 'lavadora' | 'secadora'

  if (!['lavadora', 'secadora'].includes(slot)) {
    return res.status(400).json({ message: "slot inválido: usa 'lavadora' o 'secadora'." });
  }
  if (!carga_id || !maquina_id) {
    return res.status(400).json({ message: 'carga_id y maquina_id son requeridos.' });
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
      return res.status(400).json({ message: 'No se puede asignar una máquina a una nota finalizada o cancelada.' });
    }

    const { rows: cargaRows } = await client.query(
      `SELECT id, lavadora_id, secadora_id, lavadora_tipo, secadora_tipo
         FROM nota_cargas WHERE id = $1 AND nota_id = $2 FOR UPDATE`,
      [carga_id, id]
    );
    if (cargaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'La carga no pertenece a la nota.' });
    }
    const carga = cargaRows[0];
    const tipoPrevisto = slot === 'lavadora' ? carga.lavadora_tipo : carga.secadora_tipo;
    const yaAsignada   = slot === 'lavadora' ? carga.lavadora_id   : carga.secadora_id;
    if (!tipoPrevisto) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La carga no tiene ${slot} por asignar.` });
    }
    if (yaAsignada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La carga ya tiene ${slot} asignada.` });
    }

    const { rows: maqRows } = await client.query(
      'SELECT id, nombre, tipo, tamano, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquina_id, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    const maq = maqRows[0];
    if (maq.estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `La máquina ${maq.nombre} no está disponible.` });
    }
    // El tipo de la máquina debe coincidir con el previsto de la carga.
    if (slot === 'lavadora') {
      if (maq.tipo === 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} es una secadora, no una lavadora.` });
      }
      const tipoMaq = maq.tipo === 'lavadora_jumbo' ? 'jumbo' : 'mediana';
      if (tipoMaq !== tipoPrevisto) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La lavadora debe ser ${tipoPrevisto} (${maq.nombre} es ${tipoMaq}).` });
      }
    } else {
      // La secadora es de un solo tamaño: cualquier secadora disponible sirve.
      if (maq.tipo !== 'secadora') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${maq.nombre} no es una secadora.` });
      }
    }

    const col = slot === 'lavadora' ? 'lavadora_id' : 'secadora_id';
    const colUsada = slot === 'lavadora' ? 'lavadora_usada_id' : 'secadora_usada_id';
    await client.query(
      `UPDATE nota_cargas SET ${col} = $1, ${colUsada} = $1 WHERE id = $2`,
      [maquina_id, carga_id]
    );

    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT n.* FROM notas n WHERE n.id = $1', [id]);
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('asignarCargaMaquina error:', err);
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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
    await marcarMaquinasIniciadas(client, id, [secadora_id]);
    // Cada carga cobra el secado según el tamaño de la secadora (prenda edredón
    // manda sobre el tamaño).
    for (const c of objetivo) {
      await client.query(
        `UPDATE nota_cargas SET secadora_id = $1, secadora_usada_id = $1, precio_secadora = $2 WHERE id = $3`,
        [secadora_id, tarifaSecadora(secadoraTamano, c.tipo_prenda, t), c.id]
      );
    }
    await sellarCicloMaquinas(client, id);
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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
// Asigna una máquina extra (lavadora o secadora) a la nota. Sin `carga_id` se
// crea una CARGA NUEVA; con `carga_id` la máquina se suma a esa carga, llenando
// su hueco libre (p. ej. la secadora de una carga que solo tiene lavadora).
// La máquina queda ASIGNADA pero disponible (En Espera): NO arranca aquí,
// el empleado la inicia manualmente desde Salidas (igual que al crear la nota).
// `cobrar` decide si la carga suma su tarifa al total (true) o va sin costo
// (false, precio 0). Disponible mientras la nota no esté finalizada ni cancelada.
// No toca estado_pago: igual que agregar productos, un cobro posterior a una
// nota pagada se maneja aparte.
export const asignarMaquina = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, maquina_ids, cobrar, carga_id } = req.body;

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
      'SELECT estado, tipo_prenda FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    const { rows: [{ max_orden }] } = await client.query(
      'SELECT COALESCE(MAX(orden), 0)::int AS max_orden FROM nota_cargas WHERE nota_id = $1',
      [id]
    );

    const t = await tarifasCarga(client);
    const precioLav = m => cobrar ? tarifaLavadora(m.tipo, tipoPrenda, t) : 0;
    const precioSec = m => cobrar ? tarifaSecadora(m.tamano, tipoPrenda, t) : 0;

    // Si se indica carga_id, la primera pareja se agrega a ESA carga en vez de
    // crear una carga nueva; las parejas que sobren sí se agregan como cargas
    // nuevas. La carga puede estar vacía (creada al hacer la nota sin máquina) o
    // ya traer una máquina: p. ej. sumarle la secadora a una carga que solo
    // tiene lavadora. Solo se puede llenar un hueco libre — una carga tiene a lo
    // más una lavadora y una secadora, contando también las ya usadas.
    let cargaObjetivo = null;
    if (carga_id != null) {
      const { rows: cRows } = await client.query(
        `SELECT id, orden, tipo_prenda, lavadora_id, secadora_id,
                lavadora_usada_id, secadora_usada_id
           FROM nota_cargas WHERE id = $1 AND nota_id = $2 FOR UPDATE`,
        [Number(carga_id), id]
      );
      if (cRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La carga indicada no existe en esta nota.' });
      }
      const c = cRows[0];
      const cargaTieneLav = Boolean(c.lavadora_id || c.lavadora_usada_id);
      const cargaTieneSec = Boolean(c.secadora_id || c.secadora_usada_id);
      if (cargaTieneLav && lavadoras.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La carga ${c.orden} ya tiene lavadora.` });
      }
      if (cargaTieneSec && secadoras.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La carga ${c.orden} ya tiene secadora.` });
      }
      cargaObjetivo = c;
    }

    // Empareja lavadora+secadora en una misma carga (un ciclo completo). Las que
    // sobran de un tipo van cada una en su propia carga.
    const nuevas = [];
    const n = Math.max(lavadoras.length, secadoras.length);
    for (let i = 0; i < n; i++) {
      nuevas.push({ lavadora: lavadoras[i] ?? null, secadora: secadoras[i] ?? null });
    }

    // La máquina NO arranca aquí: queda asignada pero disponible (En Espera) y
    // el empleado la inicia manualmente desde Salidas, igual que al crear la nota.
    let nuevoOrden = max_orden;
    for (let i = 0; i < nuevas.length; i++) {
      const { lavadora, secadora } = nuevas[i];
      // La primera pareja llena la carga objetivo (si se indicó): conserva su
      // orden, prenda y es_adicional originales; solo se le ponen las máquinas.
      if (cargaObjetivo && i === 0) {
        const prendaCarga = cargaObjetivo.tipo_prenda ?? tipoPrenda;
        if (String(prendaCarga).toUpperCase() === 'EDREDON' && lavadora && lavadora.tipo !== 'lavadora_jumbo') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
        }
        // Solo se toca el hueco que se está llenando: si la carga ya traía la
        // otra máquina (o su precio), se conserva tal cual.
        await client.query(
          `UPDATE nota_cargas
              SET lavadora_id       = COALESCE($1::int, lavadora_id),
                  secadora_id       = COALESCE($2::int, secadora_id),
                  lavadora_usada_id = COALESCE($1::int, lavadora_usada_id),
                  secadora_usada_id = COALESCE($2::int, secadora_usada_id),
                  precio_lavadora   = CASE WHEN $1::int IS NULL THEN precio_lavadora ELSE $3 END,
                  precio_secadora   = CASE WHEN $2::int IS NULL THEN precio_secadora ELSE $4 END
            WHERE id = $5`,
          [
            lavadora ? lavadora.id : null,
            secadora ? secadora.id : null,
            lavadora && cobrar ? tarifaLavadora(lavadora.tipo, prendaCarga, t) : 0,
            secadora && cobrar ? tarifaSecadora(secadora.tamano, prendaCarga, t) : 0,
            cargaObjetivo.id,
          ]
        );
        continue;
      }
      nuevoOrden += 1;
      await client.query(
        `INSERT INTO nota_cargas
           (nota_id, orden, lavadora_id, secadora_id, lavadora_usada_id, secadora_usada_id,
            precio_lavadora, precio_secadora, tipo_prenda, es_adicional)
         VALUES ($1, $2, $3, $4, $3, $4, $5, $6, $7, TRUE)`,
        [
          id, nuevoOrden,
          lavadora ? lavadora.id : null,
          secadora ? secadora.id : null,
          lavadora ? precioLav(lavadora) : 0,
          secadora ? precioSec(secadora) : 0,
          tipoPrenda,
        ]
      );
    }

    // Estado según las máquinas EN USO: las nuevas no cuentan (no se iniciaron).
    // Si nada corre, la nota queda En Espera (reabre una nota LISTA para poder
    // iniciarla).
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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
    // Si la máquina está en uso puede ser por ESTA nota (hay que detenerla
    // antes) o por OTRA que se le adelantó al iniciar: en ese caso justamente
    // hay que poder cambiarla, que es lo que pide el aviso de Salidas.
    if (actRows[0].estado !== 'disponible') {
      const otra = await notaQueUsaMaquina(client, Number(maquina_actual_id), Number(id));
      if (!otra) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Solo puedes cambiar una máquina que aún no ha iniciado. Detén su ciclo primero.' });
      }
    }
    const esSecadora = actRows[0].tipo === 'secadora';
    const cargaCol   = esSecadora ? 'secadora_id'        : 'lavadora_id';
    const usadaCol   = esSecadora ? 'secadora_usada_id'  : 'lavadora_usada_id';
    const precioCol  = esSecadora ? 'precio_secadora'    : 'precio_lavadora';

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
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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

    // Estado según máquinas en uso (la quitada no contaba); total recalculado.
    const nuevoEstado = await faseProcesoDeNota(client, id);
    await client.query('UPDATE notas SET estado = $1 WHERE id = $2', [nuevoEstado, id]);
    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // La lavadora debe pertenecer a alguna carga de la nota.
    const { rows: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    if (cargasLav.length === 0) {
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
    await marcarMaquinasIniciadas(client, id, [secadora_id]);
    await sellarCicloMaquinas(client, id);
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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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
    if (cargasSec === 0) {
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
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
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

// ── PATCH /notas/:id/terminar-lavado-final ──────────────────
// Finaliza una carga de Autoservicio cuya máquina es una LAVADORA, SIN pasar a
// secado (en Autoservicio cada carga es una sola máquina independiente). Libera
// la lavadora y, si era la última máquina en uso, deja la nota LISTA; si quedan
// otras, recalcula la fase. Espejo de terminarSecado pero para el slot lavadora.
export const terminarLavadoFinal = async (req, res) => {
  const { id } = req.params;
  const { lavadora_id } = req.body;

  if (!lavadora_id) {
    return res.status(400).json({ message: 'lavadora_id es requerido.' });
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
    if (!['LAVANDO', 'SECANDO'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el lavado de una nota en proceso.' });
    }

    const { rowCount: cargasLav } = await client.query(
      'SELECT id FROM nota_cargas WHERE nota_id = $1 AND lavadora_id = $2 FOR UPDATE',
      [id, lavadora_id]
    );
    if (cargasLav === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La lavadora no está asignada a esta nota.' });
    }

    // Desvincular y liberar la lavadora (queda libre para el siguiente cliente).
    await client.query(
      'UPDATE nota_cargas SET lavadora_id = NULL WHERE nota_id = $1 AND lavadora_id = $2',
      [id, lavadora_id]
    );
    await client.query(
      `UPDATE maquinas SET estado = 'disponible', en_uso_desde = NULL
        WHERE id = $1 AND estado = 'en_uso'`,
      [lavadora_id]
    );

    // ¿Quedan máquinas en uso? Si no, la nota está lista; si sí, se recalcula fase.
    const restantes = await maquinasDeNota(client, id);
    const { rowCount: enUso } = restantes.length === 0
      ? { rowCount: 0 }
      : await client.query(
          `SELECT id FROM maquinas WHERE id = ANY($1) AND estado = 'en_uso'`,
          [restantes]
        );
    const nuevoEstado = enUso === 0 ? 'LISTA' : await faseProcesoDeNota(client, id);
    await client.query(`UPDATE notas SET estado = $1 WHERE id = $2`, [nuevoEstado, id]);

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT n.*,
              c.nombre   AS cliente_nombre,
              c.apellido AS cliente_apellido,
              c.telefono AS cliente_telefono,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       WHERE n.id = $1`,
      [id]
    );
    res.json({ ...rows[0], cargas: await cargasDeNota(pool, id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('terminarLavadoFinal error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/estado-pago ────────────────────────────
export const cambiarEstadoPago = async (req, res) => {
  const { id } = req.params;
  const { estado_pago, forma_pago } = req.body;

  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }

  // Cobrar exige saber CÓMO se pagó: sin este dato el corte de caja no puede
  // distinguir el dinero del cajón de las transferencias y tarjetas, y el
  // faltante aparente sale a costa del empleado en turno.
  const formaPago = normalizarFormaPago(forma_pago);
  if (estado_pago === 'PAGADO' && !formaPago) {
    return res.status(400).json({
      message: `Indica la forma de pago. Valores permitidos: ${FORMAS_PAGO_VALIDAS.join(', ')}.`,
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

    // Al revertir un pago la forma deja de aplicar y se limpia, para que no
    // quede una nota PENDIENTE marcada como pagada en efectivo.
    const { rows } = await client.query(
      'UPDATE notas SET estado_pago = $1, forma_pago = $2 WHERE id = $3 RETURNING *',
      [estado_pago, estado_pago === 'PAGADO' ? formaPago : null, id]
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

// ── PATCH /notas/:id/telefono ───────────────────────────────
// Guarda un teléfono de contacto a nivel nota (para el ticket de Autoservicio,
// que es anónimo). Se normaliza a solo dígitos; vacío = null.
export const guardarTelefono = async (req, res) => {
  const { id } = req.params;
  const { telefono } = req.body;
  const digits = String(telefono ?? '').replace(/\D/g, '');
  const valor = digits.length > 0 ? digits : null;
  try {
    const { rows } = await pool.query(
      'UPDATE notas SET telefono = $1 WHERE id = $2 AND sucursal = $3 RETURNING id, telefono',
      [valor, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('guardarTelefono error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /notas/:id/productos ────────────────────────────────
export const getNotaProductos = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT np.id, np.producto_id, a.nombre, np.cantidad, np.precio_unitario,
              a.tipo_liquido, a.clase, a.tamano_bolsa, a.marca,
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
      'SELECT estado, tipo_servicio FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // La unidad/precio/tapas se resuelven según el servicio (botella o tapa).
    let fila;
    try {
      fila = await reservarProducto(client, id, null, producto_id, cantidad, req.sucursal, notaRows[0].tipo_servicio);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: e.message });
    }

    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

    await client.query('COMMIT');
    res.status(201).json(fila);
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
      [np.cantidad_tapas, productoId]
    );

    // Si el cambio movió el total y la nota ya estaba pagada, el cobro deja de
    // corresponder: vuelve a PENDIENTE para cobrarla por el importe nuevo.
    await recalcularPrecioTotal(client, id, {
      desmarcarPagoSiCambia: true, usuarioId: req.user?.id, sucursal: req.sucursal,
    });

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
