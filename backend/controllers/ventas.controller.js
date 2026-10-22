import pool from '../db/pool.js';
import { TZ_NEGOCIO, fechaLocal, esFechaISO } from '../utils/tz.js';
import { esCronometroSql, CICLOS_DE_PASADAS, TOPE_RELOJ } from '../db/sqlMaquina.js';
import { leerCortes, repartirCobros } from './caja.controller.js';

/**
 * Zona del negocio como literal SQL: los días de los reportes son locales, no
 * UTC. Va interpolada (no como parámetro) para no mover la numeración $1/$2 de
 * los períodos; por eso se valida el nombre.
 */
const TZ = /^[A-Za-z0-9/_+-]+$/.test(TZ_NEGOCIO) ? `'${TZ_NEGOCIO}'` : `'America/Mexico_City'`;
/**
 * Fecha local de una columna timestamptz como 'YYYY-MM-DD'. Texto y no date,
 * para que el JSON no la convierta en un instante UTC.
 */
const fechaNegocio = (col) => `to_char(${col} AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`;

/**
 * Condición SQL del período sobre la columna `col` (por defecto el día del
 * cobro). Con `anioParam` el año llega en $1 (y con `mesParam`, el mes en $2);
 * sin ellos, el año o mes en curso. 'custom' usa $1 y $2 como fechas.
 */
function buildPeriodSQL(periodo, col = 'o.pagado_en', anioParam = false, mesParam = false) {
  switch (periodo) {
    case 'semana': return `${col} >= NOW() - INTERVAL '7 days'`;
    case 'mes':    return mesParam
      // Año en $1, mes 1-12 en $2.
      ? `DATE_PART('year', ${col} AT TIME ZONE ${TZ}) = $1 AND DATE_PART('month', ${col} AT TIME ZONE ${TZ}) = $2`
      : `${col} >= DATE_TRUNC('month', NOW() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`;
    case 'anio':   return anioParam
      ? `DATE_PART('year', ${col} AT TIME ZONE ${TZ}) = $1`
      : `${col} >= DATE_TRUNC('year', NOW() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`;
    case 'custom': return `(${col} AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date`; // params $1/$2 set by caller
    default:       return `(${col} AT TIME ZONE ${TZ})::date = (NOW() AT TIME ZONE ${TZ})::date`;
  }
}

/**
 * Resumen de Ventas del período: tarjetas, gráfica, lista de notas, corte por
 * concepto, abonos, correcciones y turnos de caja. Un empleado solo recibe el
 * total de hoy (`req.soloTotal`).
 */
export async function getResumen(req, res) {
  const { periodo = 'hoy', desde, hasta, year, month } = req.query;

  const isCustom = periodo === 'custom';
  const yearNum = /^\d{4}$/.test(String(year ?? '')) ? Number(year) : null;
  // Año específico: solo aplica al período 'anio'.
  const anioSel = periodo === 'anio' && yearNum != null ? yearNum : null;
  // Mes específico (0-11) del año elegido o, si no llega, del año en curso del
  // negocio (no del servidor en UTC).
  const mesRaw = Number(month);
  const mesSel = periodo === 'mes' && Number.isInteger(mesRaw) && mesRaw >= 0 && mesRaw <= 11 ? mesRaw : null;
  const anioNegocio = () => Number(fechaLocal().slice(0, 4));
  const anioMes = mesSel != null ? (yearNum != null ? yearNum : anioNegocio()) : null;

  const periodSQL = buildPeriodSQL(periodo, 'o.pagado_en', anioSel != null, mesSel != null);
  const periodListSQL = buildPeriodSQL(periodo, 'o.created_at', anioSel != null, mesSel != null);
  // Correcciones de forma de pago: por cuándo se corrigieron.
  const periodCorrSQL = buildPeriodSQL(periodo, 'h.created_at', anioSel != null, mesSel != null);
  // El dinero cuenta el día que entró: cada abono su día y, al liquidar, lo que
  // faltaba. Así cuadra con los cortes de caja.
  const periodCobroSQL = buildPeriodSQL(periodo, 'c.momento', anioSel != null, mesSel != null);
  // Turnos de caja del período, por cuándo se abrieron.
  const periodTurnoSQL = buildPeriodSQL(periodo, 'c.abierta_at', anioSel != null, mesSel != null);

  if (isCustom && (!desde || !hasta)) {
    return res.status(400).json({ message: 'Elige la fecha de inicio y la de fin del período.' });
  }
  // Se validan antes: una fecha inválida haría fallar el ::date con un 500.
  if (isCustom && (!esFechaISO(desde) || !esFechaISO(hasta))) {
    return res.status(400).json({ message: 'Las fechas del período no son válidas.' });
  }
  if (isCustom && desde > hasta) {
    return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la de fin.' });
  }

  const periodParams = isCustom
    ? [desde, hasta]
    : anioSel != null ? [anioSel] : (mesSel != null ? [anioMes, mesSel + 1] : []);

  // Notas pagadas y no canceladas de la sucursal, por día de cobro. La sucursal
  // va después de los parámetros del período.
  const sucIdx = periodParams.length + 1;
  const params = [...periodParams, req.sucursal];
  const whereBase = `o.estado_pago = 'PAGADO' AND o.estado != 'CANCELADA' AND o.sucursal = $${sucIdx} AND ${periodSQL}`;
  // Lista: todas las notas del período; las canceladas no cuentan en totales.
  const whereLista = `o.sucursal = $${sucIdx} AND ${periodListSQL}`;

  // Cada peso cobrado, con el momento en que entró y su forma de pago.
  const COBROS_CTE = `
    WITH cobros AS (
      -- Lo que se cobró al liquidar: el total menos lo que ya se había abonado.
      SELECT o.sucursal, o.forma_pago, o.pagado_en AS momento,
             o.precio_total - COALESCE((
               SELECT SUM(ab.monto) FROM nota_abonos ab
                WHERE ab.nota_id = o.id AND ab.revertido_at IS NULL
             ), 0) AS monto
        FROM notas o
       WHERE o.estado_pago = 'PAGADO' AND o.estado != 'CANCELADA'
      UNION ALL
      -- Y cada abono, el día que se hizo.
      SELECT n.sucursal, ab.forma_pago, ab.created_at AS momento, ab.monto
        FROM nota_abonos ab
        JOIN notas n ON n.id = ab.nota_id
       WHERE ab.revertido_at IS NULL AND n.estado != 'CANCELADA'
    )`;
  const whereCobro = `c.sucursal = $${sucIdx} AND ${periodCobroSQL}`;

  try {
    const [tarjetasRes, pendientesRes, graficaRes, listaRes, corteRes, correccionesRes, abonosRes, cobradoRes] = await Promise.all([
      // Tarjetas: total_cobrado, notas_pagadas, productos_consumidos
      pool.query(
        `SELECT
          COALESCE(SUM(o.precio_total), 0)           AS total_cobrado,
          COUNT(o.id)                                 AS notas_pagadas,
          COALESCE(SUM(np_t.total_qty), 0)            AS productos_consumidos
        FROM notas o
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad) AS total_qty
          FROM nota_productos
          GROUP BY nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereBase}`,
        params
      ),

      // Pendientes: sin filtro de período, solo de la sucursal activa
      pool.query(
        `SELECT COUNT(*) AS notas_pendientes
        FROM notas
        WHERE estado_pago = 'PENDIENTE' AND estado != 'CANCELADA' AND sucursal = $1`,
        [req.sucursal]
      ),

      // Gráfica: dinero que entró por fecha (liquidaciones y abonos)
      pool.query(
        `${COBROS_CTE}
         SELECT ${fechaNegocio('c.momento')} AS fecha, COALESCE(SUM(c.monto), 0) AS total
        FROM cobros c
        WHERE ${whereCobro}
        GROUP BY 1
        ORDER BY fecha ASC`,
        params
      ),

      // Lista de notas: todas las del período (pagadas o no)
      pool.query(
        `SELECT
          o.id,
          o.folio,
          ${fechaNegocio('o.created_at')}              AS fecha,
          o.created_at                                AS creado_en,
          o.estado,
          o.estado_pago,
          o.forma_pago,
          -- LISTA se lee "Por Cobrar" en Autoservicio y "Por Entregar" en los demás.
          o.tipo_servicio,
          o.motivo_cancelacion,
          -- Máquinas de la nota: [{ nombre, cargas, segundos, tope, tope_vivo }].
          -- "segundos" suma las vueltas finalizadas (null si ninguna); "tope",
          -- si alguna llegó al tope; "tope_vivo", la que ya llegó y sigue sin
          -- finalizar (se cuenta en vivo, si esta nota la arrancó).
          COALESCE((
            SELECT json_agg(json_build_object(
                     'nombre', t.nombre, 'cargas', t.cargas,
                     'segundos', CASE WHEN t.tope_vivo
                                      THEN COALESCE(t.segundos, 0) + t.ciclo_minutos * 60
                                      ELSE t.segundos END,
                     'tope', t.tope OR t.tope_vivo) ORDER BY t.nombre)
              FROM (
                SELECT mm.nombre, COUNT(*)::int AS cargas,
                       -- Dónde se para su reloj (con "Otro ciclo", el fin real).
                       ${TOPE_RELOJ('mm')} AS ciclo_minutos,
                       (mm.en_uso_desde IS NOT NULL
                        AND mm.ciclo_minutos > 0
                        AND ${esCronometroSql('mm')}
                        AND mm.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('mm')}) <= NOW()
                        AND COALESCE(bool_or(
                              (nc.lavadora_id = mm.id AND nc.lavadora_iniciada_at IS NOT NULL)
                           OR (nc.secadora_id = mm.id AND nc.secadora_iniciada_at IS NOT NULL)), FALSE)
                       ) IS TRUE AS tope_vivo,
                       (SELECT ROUND(SUM(EXTRACT(EPOCH FROM ncm.finalizada_at - ncm.encendida_at)))::int
                          FROM nota_carga_maquinas ncm
                          JOIN nota_cargas c2 ON c2.id = ncm.carga_id
                         WHERE c2.nota_id = o.id
                           AND ncm.maquina_id = mm.id
                           AND ncm.encendida_at IS NOT NULL
                           AND ncm.finalizada_at IS NOT NULL) AS segundos
                       ,EXISTS (SELECT 1
                          FROM nota_carga_maquinas ncm
                          JOIN nota_cargas c2 ON c2.id = ncm.carga_id
                         WHERE c2.nota_id = o.id
                           AND ncm.maquina_id = mm.id
                           AND ncm.llego_tope) AS tope
                  FROM nota_cargas nc
                  JOIN maquinas mm
                    ON mm.id = ANY(ARRAY[nc.lavadora_id, nc.secadora_id,
                                         nc.lavadora_usada_id, nc.secadora_usada_id])
                 WHERE nc.nota_id = o.id
                 GROUP BY mm.id, mm.nombre
              ) t
          ), '[]'::json)                               AS maquinas,
          -- Un renglón por ciclo: máquina, lo que vale, inicio, fin y minutos.
          COALESCE((
            SELECT json_agg(json_build_object(
                     'nombre', c.maquina_nombre, 'precio', c.precio,
                     'segundos', c.segundos, 'tope', c.tope,
                     'inicio_at', c.inicio_at, 'fin_at', c.fin_at
                   ) ORDER BY c.carga_orden, c.asignada_at, c.pasada_id)
              FROM (${CICLOS_DE_PASADAS('n.id = o.id')}) c
          ), '[]'::json)                               AS ciclos,
          NULLIF(TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')), '') AS atendio,
          -- Abonos vivos de la nota, del más viejo al más nuevo.
          COALESCE((
            SELECT json_agg(json_build_object(
                     'id', ab.id, 'monto', ab.monto, 'forma_pago', ab.forma_pago,
                     'creado_en', ab.created_at,
                     'recibio', NULLIF(TRIM(ua.nombre || ' ' || COALESCE(ua.apellido, '')), '')
                   ) ORDER BY ab.created_at, ab.id)
              FROM nota_abonos ab
              LEFT JOIN usuarios ua ON ua.id = ab.usuario_id
             WHERE ab.nota_id = o.id AND ab.revertido_at IS NULL
          ), '[]'::json)                               AS abonos,
          (SELECT COUNT(*) FROM nota_cargas nc WHERE nc.nota_id = o.id)::int AS cargas,
          COALESCE(np_t.total_productos, 0)            AS total_productos,
          -- Productos de la nota; "incluido" = va en el precio del servicio.
          COALESCE((
            SELECT json_agg(json_build_object(
                     'nombre', a.nombre, 'marca', a.marca, 'clase', a.clase,
                     'tamano_bolsa', a.tamano_bolsa, 'tipo_liquido', a.tipo_liquido,
                     'forma', a.forma, 'se_vende_por_unidad', a.se_vende_por_unidad,
                     'unidad', np.unidad, 'cantidad', np.cantidad,
                     'subtotal', np.cantidad * np.precio_unitario,
                     'incluido', NOT (o.tipo_servicio <> 'POR_ENCARGO'
                                      OR a.se_vende_por_unidad
                                      OR (np.carga_id IS NOT NULL AND nc.precio_tope IS NULL))
                   ) ORDER BY np.created_at, np.id)
              FROM nota_productos np
              JOIN productos a ON a.id = np.producto_id
              LEFT JOIN nota_cargas nc ON nc.id = np.carga_id
             WHERE np.nota_id = o.id
          ), '[]'::json)                               AS productos,
          o.precio_total                               AS total
        FROM notas o
        LEFT JOIN usuarios u ON u.id = o.usuario_id
        -- Productos cobrados aparte (en Por Encargo, el material va en el servicio).
        LEFT JOIN (
          SELECT np.nota_id, SUM(np.cantidad * np.precio_unitario) AS total_productos
          FROM nota_productos np
          JOIN notas n2    ON n2.id = np.nota_id
          JOIN productos a ON a.id = np.producto_id
          LEFT JOIN nota_cargas nc ON nc.id = np.carga_id
          WHERE n2.tipo_servicio <> 'POR_ENCARGO'
             OR a.se_vende_por_unidad
             OR (np.carga_id IS NOT NULL AND nc.precio_tope IS NULL)
          GROUP BY np.nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereLista}
        ORDER BY o.created_at DESC`,
        params
      ),

      // Corte por concepto con la misma regla que recalcularPrecioTotal, para
      // que cuadre con lo cobrado. El ajuste de cada carga va con el de la nota.
      pool.query(
        `WITH conceptos AS (
           SELECT o.id,
                  o.ajuste,
                  COALESCE(SUM(CASE WHEN o.tipo_servicio = 'POR_ENCARGO' AND nc.precio_tope IS NOT NULL
                                    THEN nc.precio_tope END), 0)                       AS servicios,
                  COALESCE(SUM(CASE WHEN NOT (o.tipo_servicio = 'POR_ENCARGO' AND nc.precio_tope IS NOT NULL)
                                    THEN nc.precio_lavadora + nc.precio_secadora + nc.precio_fichas_extra END), 0) AS cargas,
                  COALESCE(SUM(nc.ajuste), 0)                                         AS ajuste_cargas
             FROM notas o
             LEFT JOIN nota_cargas nc ON nc.nota_id = o.id
            WHERE ${whereBase}
            GROUP BY o.id
         ),
         productos_aparte AS (
           -- Solo lo cobrado encima: en Por Encargo lo que se vende por unidad
           -- (o todo, sin precio de servicio); en los demás, todo.
           SELECT np.nota_id, SUM(np.cantidad * np.precio_unitario) AS total
             FROM nota_productos np
             JOIN notas o     ON o.id = np.nota_id
             JOIN productos a ON a.id = np.producto_id
             LEFT JOIN nota_cargas nc ON nc.id = np.carga_id
            WHERE ${whereBase}
              AND (o.tipo_servicio <> 'POR_ENCARGO'
                   OR a.se_vende_por_unidad
                   OR (np.carga_id IS NOT NULL AND nc.precio_tope IS NULL))
            GROUP BY np.nota_id
         )
         SELECT
          COALESCE(SUM(c.servicios), 0)                    AS total_servicios,
          COALESCE(SUM(c.cargas), 0)                       AS total_cargas,
          COALESCE(SUM(pa.total), 0)                       AS total_productos,
          COALESCE(SUM(c.ajuste + c.ajuste_cargas), 0)     AS total_ajustes
        FROM conceptos c
        LEFT JOIN productos_aparte pa ON pa.nota_id = c.id`,
        params
      ),
      // Correcciones de forma de pago del período.
      pool.query(
        `SELECT o.id AS nota_id, o.folio, o.precio_total,
                h.forma_anterior, h.forma_nueva, h.created_at,
                TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
           FROM nota_forma_pago_historial h
           JOIN notas o ON o.id = h.nota_id
           LEFT JOIN usuarios u ON u.id = h.usuario_id
          WHERE o.sucursal = $${sucIdx} AND ${periodCorrSQL}
          ORDER BY h.created_at DESC`,
        params
      ),

      // Abonos vivos del período: quién lo recibió y de qué nota.
      pool.query(
        `SELECT ab.id, ab.monto, ab.forma_pago, ab.created_at,
                ${fechaNegocio('ab.created_at')} AS fecha,
                n.id AS nota_id, n.folio,
                TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS recibio
           FROM nota_abonos ab
           JOIN notas n ON n.id = ab.nota_id
           LEFT JOIN usuarios u ON u.id = ab.usuario_id
          WHERE n.sucursal = $${sucIdx} AND ab.revertido_at IS NULL
            AND n.estado != 'CANCELADA'
            AND ${buildPeriodSQL(periodo, 'ab.created_at', anioSel != null, mesSel != null)}
          ORDER BY ab.created_at DESC`,
        params
      ),

      // Dinero que entró en el período, por forma de pago.
      pool.query(
        `${COBROS_CTE}
         SELECT
          COALESCE(SUM(c.monto), 0) AS total_cobrado,
          COALESCE(SUM(c.monto) FILTER (
            WHERE COALESCE(c.forma_pago, 'EFECTIVO') = 'EFECTIVO'), 0) AS total_efectivo,
          COALESCE(SUM(c.monto) FILTER (WHERE c.forma_pago = 'TRANSFERENCIA'), 0) AS total_transferencia,
          COALESCE(SUM(c.monto) FILTER (WHERE c.forma_pago = 'TARJETA'), 0) AS total_tarjeta
         FROM cobros c
        WHERE ${whereCobro}`,
        params
      ),
    ]);

    const tarjetas = tarjetasRes.rows[0];
    const pendientesRow = pendientesRes.rows[0];
    const corte = corteRes.rows[0];

    const total_servicios = parseFloat(corte.total_servicios);
    const total_cargas    = parseFloat(corte.total_cargas);
    const total_productos = parseFloat(corte.total_productos);
    const total_ajustes   = parseFloat(corte.total_ajustes);
    // El dinero sale de los cobros (cada abono en su día), no de las notas.
    const cobrado = cobradoRes.rows[0];
    const total_efectivo      = parseFloat(cobrado.total_efectivo);
    const total_transferencia = parseFloat(cobrado.total_transferencia);
    const total_tarjeta       = parseFloat(cobrado.total_tarjeta);
    const total_cobrado       = parseFloat(cobrado.total_cobrado);

    const turnos = await leerCortes(pool, `c.sucursal = $${sucIdx} AND ${periodTurnoSQL}`, params);

    // Cada cobro del período repartido por concepto, como el corte de Caja.
    // Suman el total cobrado.
    const conceptos = await repartirCobros(pool, `
        SELECT o.id AS nota_id,
               o.precio_total - COALESCE((
                 SELECT SUM(ab.monto) FROM nota_abonos ab
                  WHERE ab.nota_id = o.id AND ab.revertido_at IS NULL
               ), 0) AS monto
          FROM notas o
         WHERE o.estado_pago = 'PAGADO' AND o.estado <> 'CANCELADA'
           AND o.sucursal = $${sucIdx} AND ${periodSQL}
        UNION ALL
        SELECT ab.nota_id, ab.monto
          FROM nota_abonos ab
          JOIN notas o ON o.id = ab.nota_id
         WHERE ab.revertido_at IS NULL AND o.estado <> 'CANCELADA'
           AND o.sucursal = $${sucIdx} AND ${buildPeriodSQL(periodo, 'ab.created_at', anioSel != null, mesSel != null)}`,
      params);

    // Empleado en el Dashboard: solo el total de hoy (ver ventas.routes.js).
    if (req.soloTotal) return res.json({ tarjetas: { total_cobrado } });

    res.json({
      tarjetas: {
        total_cobrado:       total_cobrado,
        notas_pagadas:       parseInt(tarjetas.notas_pagadas, 10),
        productos_consumidos: parseInt(tarjetas.productos_consumidos, 10),
        notas_pendientes:    parseInt(pendientesRow.notas_pendientes, 10),
      },
      grafica: graficaRes.rows.map((r) => ({
        fecha: r.fecha,
        total: parseFloat(r.total),
      })),
      lista_notas: listaRes.rows.map((r) => ({
        id:              r.id,
        folio:           r.folio,
        fecha:           r.fecha,
        creado_en:       r.creado_en,
        estado:          r.estado,
        estado_pago:     r.estado_pago,
        forma_pago:      r.forma_pago,
        tipo_servicio:   r.tipo_servicio,
        motivo_cancelacion: r.motivo_cancelacion,
        maquinas:        r.maquinas ?? [],
        ciclos:          (r.ciclos ?? []).map((c) => ({ ...c, precio: parseFloat(c.precio) || 0 })),
        abonos:          (r.abonos ?? []).map((a) => ({ ...a, monto: parseFloat(a.monto) })),
        atendio:         r.atendio,
        cargas:          parseInt(r.cargas, 10),
        total_productos: parseFloat(r.total_productos),
        productos:       (r.productos ?? []).map((p) => ({
          ...p, cantidad: Number(p.cantidad), subtotal: parseFloat(p.subtotal),
        })),
        total:           parseFloat(r.total),
      })),
      corte: {
        // Lavadoras medianas / jumbo, secadoras, productos, SPE y edredón.
        conceptos,
        total_servicios,
        total_cargas,
        total_productos,
        total_ajustes,
        // Suma de los conceptos facturados.
        total_general: total_servicios + total_cargas + total_productos + total_ajustes,
        total_efectivo,
        total_transferencia,
        total_tarjeta,
        // Lo liquidado más lo abonado: cuadra con los cortes de caja.
        total_cobrado,
      },
      // Quién recibió cada abono y de qué nota.
      abonos: abonosRes.rows.map((r) => ({
        id:         r.id,
        nota_id:    r.nota_id,
        folio:      r.folio,
        fecha:      r.fecha,
        creado_en:  r.created_at,
        monto:      parseFloat(r.monto),
        forma_pago: r.forma_pago,
        recibio:    r.recibio,
      })),
      correcciones_pago: correccionesRes.rows.map((r) => ({
        nota_id:        r.nota_id,
        folio:          r.folio,
        total:          parseFloat(r.precio_total),
        forma_anterior: r.forma_anterior,
        forma_nueva:    r.forma_nueva,
        usuario:        r.usuario_nombre,
        fecha:          r.created_at,
      })),
      // Del más viejo al más nuevo, como se leen en el día.
      turnos: turnos.reverse(),
    });
  } catch (err) {
    console.error('Error en ventas/resumen:', err);
    res.status(500).json({ message: 'No se pudo cargar el resumen de ventas. Intenta de nuevo.' });
  }
}

/** Años con notas no canceladas de la sucursal, para el filtro de período. */
export async function getAnios(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT DATE_PART('year', created_at AT TIME ZONE ${TZ})::int AS anio
         FROM notas
        WHERE sucursal = $1 AND estado != 'CANCELADA'
        ORDER BY anio DESC`,
      [req.sucursal]
    );
    res.json(rows.map((r) => r.anio));
  } catch (err) {
    console.error('Error en ventas/anios:', err);
    res.status(500).json({ message: 'No se pudieron cargar los años con ventas. Intenta de nuevo.' });
  }
}
