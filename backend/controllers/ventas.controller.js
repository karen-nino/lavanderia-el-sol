import pool from '../db/pool.js';

// El período se mide por pagado_en (día real del cobro), no por la fecha de
// creación de la nota. whereBase filtra estado_pago = 'PAGADO', así que
// pagado_en nunca es NULL en las filas que llegan a estas consultas.
function buildPeriodSQL(periodo, alias = 'o') {
  switch (periodo) {
    case 'semana': return { sql: `${alias}.pagado_en >= NOW() - INTERVAL '7 days'`, params: [] };
    case 'mes':    return { sql: `${alias}.pagado_en >= DATE_TRUNC('month', NOW())`, params: [] };
    case 'custom': return { sql: `DATE(${alias}.pagado_en) BETWEEN $1::date AND $2::date`, params: null }; // params set by caller
    default:       return { sql: `DATE(${alias}.pagado_en) = CURRENT_DATE`, params: [] };
  }
}

export async function getResumen(req, res) {
  const { periodo = 'hoy', desde, hasta } = req.query;

  const { sql: periodSQL } = buildPeriodSQL(periodo);
  const isCustom = periodo === 'custom';

  if (isCustom && (!desde || !hasta)) {
    return res.status(400).json({ message: 'Se requieren los parámetros desde y hasta para el período personalizado.' });
  }

  const periodParams = isCustom ? [desde, hasta] : [];
  const p1 = isCustom ? '$1' : null;
  const p2 = isCustom ? '$2' : null;

  // Para custom, el period ya usa $1 y $2
  // "Ingresado" = dinero efectivamente cobrado: notas con pago registrado
  // (estado_pago = 'PAGADO') y no canceladas. El período se mide por
  // pagado_en (día real del cobro).
  const whereBase = `o.estado_pago = 'PAGADO' AND o.estado != 'CANCELADA' AND ${periodSQL}`;

  try {
    const [tarjetasRes, pendientesRes, graficaRes, listaRes, corteRes] = await Promise.all([
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
        periodParams
      ),

      // Pendientes: sin filtro de período
      pool.query(
        `SELECT COUNT(*) AS notas_pendientes
        FROM notas
        WHERE estado_pago = 'PENDIENTE' AND estado != 'CANCELADA'`
      ),

      // Gráfica: por fecha
      pool.query(
        `SELECT DATE(o.pagado_en) AS fecha, COALESCE(SUM(o.precio_total), 0) AS total
        FROM notas o
        WHERE ${whereBase}
        GROUP BY DATE(o.pagado_en)
        ORDER BY fecha ASC`,
        periodParams
      ),

      // Lista de notas
      pool.query(
        `SELECT
          o.folio,
          DATE(o.pagado_en)                           AS fecha,
          COALESCE(m.nombre, 'N/A')                   AS maquina,
          o.cantidad_cargas                            AS cargas,
          COALESCE(np_t.total_productos, 0)            AS total_productos,
          o.precio_total                               AS total
        FROM notas o
        LEFT JOIN maquinas m ON m.id = o.maquina_id
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad * precio_unitario) AS total_productos
          FROM nota_productos
          GROUP BY nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereBase}
        ORDER BY o.pagado_en DESC`,
        periodParams
      ),

      // Corte de caja
      pool.query(
        `SELECT
          COALESCE(SUM(o.cantidad_cargas * COALESCE(o.precio_base, 0)), 0) AS total_cargas,
          COALESCE(SUM(np_t.total_art), 0)                                  AS total_productos,
          COALESCE(SUM(o.ajuste), 0)                                        AS total_ajustes
        FROM notas o
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad * precio_unitario) AS total_art
          FROM nota_productos
          GROUP BY nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereBase}`,
        periodParams
      ),
    ]);

    const tarjetas = tarjetasRes.rows[0];
    const pendientesRow = pendientesRes.rows[0];
    const corte = corteRes.rows[0];

    const total_cargas    = parseFloat(corte.total_cargas);
    const total_productos = parseFloat(corte.total_productos);
    const total_ajustes   = parseFloat(corte.total_ajustes);

    res.json({
      tarjetas: {
        total_cobrado:       parseFloat(tarjetas.total_cobrado),
        notas_pagadas:       parseInt(tarjetas.notas_pagadas, 10),
        productos_consumidos: parseInt(tarjetas.productos_consumidos, 10),
        notas_pendientes:    parseInt(pendientesRow.notas_pendientes, 10),
      },
      grafica: graficaRes.rows.map((r) => ({
        fecha: r.fecha,
        total: parseFloat(r.total),
      })),
      lista_notas: listaRes.rows.map((r) => ({
        folio:           r.folio,
        fecha:           r.fecha,
        maquina:         r.maquina,
        cargas:          parseInt(r.cargas, 10),
        total_productos: parseFloat(r.total_productos),
        total:           parseFloat(r.total),
      })),
      corte: {
        total_cargas,
        total_productos,
        total_ajustes,
        total_general: total_cargas + total_productos + total_ajustes,
      },
    });
  } catch (err) {
    console.error('Error en ventas/resumen:', err);
    res.status(500).json({ message: 'Error al obtener el resumen de ventas.' });
  }
}
