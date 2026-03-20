import pool from '../db/pool.js';

function buildPeriodSQL(periodo, alias = 'o') {
  switch (periodo) {
    case 'semana': return { sql: `${alias}.created_at >= NOW() - INTERVAL '7 days'`, params: [] };
    case 'mes':    return { sql: `${alias}.created_at >= DATE_TRUNC('month', NOW())`, params: [] };
    case 'custom': return { sql: `DATE(${alias}.created_at) BETWEEN $1::date AND $2::date`, params: null }; // params set by caller
    default:       return { sql: `DATE(${alias}.created_at) = CURRENT_DATE`, params: [] };
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
  const whereBase = `o.estado IN ('PAGADA', 'ENTREGADA') AND ${periodSQL}`;

  try {
    const [tarjetasRes, pendientesRes, graficaRes, listaRes, corteRes] = await Promise.all([
      // Tarjetas: total_cobrado, ordenes_pagadas, productos_consumidos
      pool.query(
        `SELECT
          COALESCE(SUM(o.precio_total), 0)           AS total_cobrado,
          COUNT(o.id)                                 AS ordenes_pagadas,
          COALESCE(SUM(oa_t.total_qty), 0)            AS productos_consumidos
        FROM ordenes o
        LEFT JOIN (
          SELECT orden_id, SUM(cantidad) AS total_qty
          FROM orden_articulos
          GROUP BY orden_id
        ) oa_t ON oa_t.orden_id = o.id
        WHERE ${whereBase}`,
        periodParams
      ),

      // Pendientes: sin filtro de período
      pool.query(
        `SELECT COUNT(*) AS ordenes_pendientes
        FROM ordenes
        WHERE estado_pago = 'DEBE' AND estado != 'CANCELADA'`
      ),

      // Gráfica: por fecha
      pool.query(
        `SELECT DATE(o.created_at) AS fecha, COALESCE(SUM(o.precio_total), 0) AS total
        FROM ordenes o
        WHERE ${whereBase}
        GROUP BY DATE(o.created_at)
        ORDER BY fecha ASC`,
        periodParams
      ),

      // Lista de órdenes
      pool.query(
        `SELECT
          o.folio,
          DATE(o.created_at)                          AS fecha,
          COALESCE(m.nombre, 'N/A')                   AS maquina,
          o.cantidad_cargas                            AS cargas,
          COALESCE(oa_t.total_productos, 0)            AS total_productos,
          o.precio_total                               AS total
        FROM ordenes o
        LEFT JOIN maquinas m ON m.id = o.maquina_id
        LEFT JOIN (
          SELECT orden_id, SUM(cantidad * precio_unitario) AS total_productos
          FROM orden_articulos
          GROUP BY orden_id
        ) oa_t ON oa_t.orden_id = o.id
        WHERE ${whereBase}
        ORDER BY o.created_at DESC`,
        periodParams
      ),

      // Corte de caja
      pool.query(
        `SELECT
          COALESCE(SUM(o.cantidad_cargas * COALESCE(o.precio_base, 0)), 0) AS total_cargas,
          COALESCE(SUM(oa_t.total_art), 0)                                  AS total_productos,
          COALESCE(SUM(o.ajuste), 0)                                        AS total_ajustes
        FROM ordenes o
        LEFT JOIN (
          SELECT orden_id, SUM(cantidad * precio_unitario) AS total_art
          FROM orden_articulos
          GROUP BY orden_id
        ) oa_t ON oa_t.orden_id = o.id
        WHERE ${whereBase}`,
        periodParams
      ),
    ]);

    const tarjetas = tarjetasRes.rows[0];
    const pendientes = pendientesRes.rows[0];
    const corte = corteRes.rows[0];

    const total_cargas    = parseFloat(corte.total_cargas);
    const total_productos = parseFloat(corte.total_productos);
    const total_ajustes   = parseFloat(corte.total_ajustes);

    res.json({
      tarjetas: {
        total_cobrado:       parseFloat(tarjetas.total_cobrado),
        ordenes_pagadas:     parseInt(tarjetas.ordenes_pagadas, 10),
        productos_consumidos: parseInt(tarjetas.productos_consumidos, 10),
        ordenes_pendientes:  parseInt(pendientes.ordenes_pendientes, 10),
      },
      grafica: graficaRes.rows.map((r) => ({
        fecha: r.fecha,
        total: parseFloat(r.total),
      })),
      lista_ordenes: listaRes.rows.map((r) => ({
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
