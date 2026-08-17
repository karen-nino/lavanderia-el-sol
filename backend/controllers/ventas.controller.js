import pool from '../db/pool.js';

// El período se mide por pagado_en (día real del cobro), no por la fecha de
// creación de la nota. whereBase filtra estado_pago = 'PAGADO', así que
// pagado_en nunca es NULL en las filas que llegan a estas consultas.
// La lista de notas (todas, no solo las pagadas) usa created_at, porque una
// nota pendiente aún no tiene pagado_en.
// anioParam indica que se eligió un año específico (llega en $1); sin él,
// "anio" significa el año en curso.
function buildPeriodSQL(periodo, col = 'o.pagado_en', anioParam = false, mesParam = false) {
  switch (periodo) {
    case 'semana': return `${col} >= NOW() - INTERVAL '7 days'`;
    case 'mes':    return mesParam
      // Mes específico de un año dado (año en $1, mes 1-12 en $2).
      ? `DATE_PART('year', ${col}) = $1 AND DATE_PART('month', ${col}) = $2`
      : `${col} >= DATE_TRUNC('month', NOW())`;
    case 'anio':   return anioParam
      ? `DATE_PART('year', ${col}) = $1`
      : `${col} >= DATE_TRUNC('year', NOW())`;
    case 'custom': return `DATE(${col}) BETWEEN $1::date AND $2::date`; // params $1/$2 set by caller
    default:       return `DATE(${col}) = CURRENT_DATE`;
  }
}

export async function getResumen(req, res) {
  const { periodo = 'hoy', desde, hasta, year, month } = req.query;

  const isCustom = periodo === 'custom';
  const yearNum = /^\d{4}$/.test(String(year ?? '')) ? Number(year) : null;
  // Año específico: solo aplica al período 'anio'.
  const anioSel = periodo === 'anio' && yearNum != null ? yearNum : null;
  // Mes específico (0-11, como JS): solo aplica al período 'mes'. Usa el año
  // elegido (o el actual si no llega uno válido).
  const mesRaw = Number(month);
  const mesSel = periodo === 'mes' && Number.isInteger(mesRaw) && mesRaw >= 0 && mesRaw <= 11 ? mesRaw : null;
  const anioMes = mesSel != null ? (yearNum != null ? yearNum : new Date().getFullYear()) : null;

  const periodSQL = buildPeriodSQL(periodo, 'o.pagado_en', anioSel != null, mesSel != null);
  const periodListSQL = buildPeriodSQL(periodo, 'o.created_at', anioSel != null, mesSel != null);

  if (isCustom && (!desde || !hasta)) {
    return res.status(400).json({ message: 'Se requieren los parámetros desde y hasta para el período personalizado.' });
  }

  const periodParams = isCustom
    ? [desde, hasta]
    : anioSel != null ? [anioSel] : (mesSel != null ? [anioMes, mesSel + 1] : []);

  // "Ingresado" = dinero efectivamente cobrado: notas con pago registrado
  // (estado_pago = 'PAGADO') y no canceladas, de la sucursal activa. El
  // período se mide por pagado_en (día real del cobro). La sucursal va como
  // último parámetro, después de los del período (custom usa $1 y $2).
  const sucIdx = periodParams.length + 1;
  const params = [...periodParams, req.sucursal];
  const whereBase = `o.estado_pago = 'PAGADO' AND o.estado != 'CANCELADA' AND o.sucursal = $${sucIdx} AND ${periodSQL}`;
  // Lista: todas las notas no canceladas del período (pagadas o no).
  const whereLista = `o.estado != 'CANCELADA' AND o.sucursal = $${sucIdx} AND ${periodListSQL}`;

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
        params
      ),

      // Pendientes: sin filtro de período, solo de la sucursal activa
      pool.query(
        `SELECT COUNT(*) AS notas_pendientes
        FROM notas
        WHERE estado_pago = 'PENDIENTE' AND estado != 'CANCELADA' AND sucursal = $1`,
        [req.sucursal]
      ),

      // Gráfica: por fecha
      pool.query(
        `SELECT DATE(o.pagado_en) AS fecha, COALESCE(SUM(o.precio_total), 0) AS total
        FROM notas o
        WHERE ${whereBase}
        GROUP BY DATE(o.pagado_en)
        ORDER BY fecha ASC`,
        params
      ),

      // Lista de notas: todas las del período (pagadas o no)
      pool.query(
        `SELECT
          o.id,
          o.folio,
          DATE(o.created_at)                          AS fecha,
          o.created_at                                AS creado_en,
          o.estado,
          o.estado_pago,
          -- Máquina(s) de la nota con su número de cargas: [{ nombre, cargas }].
          -- Cuenta las cargas (nota_cargas) donde aparece cada máquina,
          -- incluidas las ya desvinculadas (*_usada_id).
          COALESCE((
            SELECT json_agg(json_build_object('nombre', t.nombre, 'cargas', t.cargas) ORDER BY t.nombre)
              FROM (
                SELECT mm.nombre, COUNT(*)::int AS cargas
                  FROM nota_cargas nc
                  JOIN maquinas mm
                    ON mm.id = ANY(ARRAY[nc.lavadora_id, nc.secadora_id,
                                         nc.lavadora_usada_id, nc.secadora_usada_id])
                 WHERE nc.nota_id = o.id
                 GROUP BY mm.nombre
              ) t
          ), '[]'::json)                               AS maquinas,
          NULLIF(TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')), '') AS atendio,
          (SELECT COUNT(*) FROM nota_cargas nc WHERE nc.nota_id = o.id)::int AS cargas,
          COALESCE(np_t.total_productos, 0)            AS total_productos,
          o.precio_total                               AS total
        FROM notas o
        LEFT JOIN usuarios u ON u.id = o.usuario_id
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad * precio_unitario) AS total_productos
          FROM nota_productos
          GROUP BY nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereLista}
        ORDER BY o.created_at DESC`,
        params
      ),

      // Corte de caja
      pool.query(
        `SELECT
          COALESCE(SUM(nc_t.total_cargas), 0)                              AS total_cargas,
          COALESCE(SUM(np_t.total_art), 0)                                  AS total_productos,
          COALESCE(SUM(o.ajuste), 0)                                        AS total_ajustes
        FROM notas o
        LEFT JOIN (
          SELECT nota_id, SUM(precio_lavadora + precio_secadora) AS total_cargas
          FROM nota_cargas
          GROUP BY nota_id
        ) nc_t ON nc_t.nota_id = o.id
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad * precio_unitario) AS total_art
          FROM nota_productos
          GROUP BY nota_id
        ) np_t ON np_t.nota_id = o.id
        WHERE ${whereBase}`,
        params
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
        id:              r.id,
        folio:           r.folio,
        fecha:           r.fecha,
        creado_en:       r.creado_en,
        estado:          r.estado,
        estado_pago:     r.estado_pago,
        maquinas:        r.maquinas ?? [],
        atendio:         r.atendio,
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

// Años con notas (no canceladas) de la sucursal activa, para el selector de
// año del filtro de período. Se mide por created_at (toda nota lo tiene).
export async function getAnios(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT DATE_PART('year', created_at)::int AS anio
         FROM notas
        WHERE sucursal = $1 AND estado != 'CANCELADA'
        ORDER BY anio DESC`,
      [req.sucursal]
    );
    res.json(rows.map((r) => r.anio));
  } catch (err) {
    console.error('Error en ventas/anios:', err);
    res.status(500).json({ message: 'Error al obtener los años de ventas.' });
  }
}
