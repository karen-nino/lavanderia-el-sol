import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';
import { COBRO_APARTE_ENCARGO } from '../db/sqlProductos.js';
import { ENTORNO_DEMO } from '../utils/entorno.js';

/**
 * Lo cobrado en una caja, por forma de pago (solo el efectivo entra al cajón).
 * Cada peso cuenta en la caja donde entró: lo que faltaba de las notas
 * liquidadas aquí (`notas.caja_id`) más los abonos vivos hechos aquí. Sin forma
 * de pago cuenta como efectivo. Las canceladas no cuentan.
 */
export async function ventasDeSesion(client, cajaId) {
  const { rows } = await client.query(
    `WITH cobros AS (
        SELECT n.forma_pago,
               n.precio_total - COALESCE((
                 SELECT SUM(ab.monto) FROM nota_abonos ab
                  WHERE ab.nota_id = n.id AND ab.revertido_at IS NULL
               ), 0) AS monto
          FROM notas n
         WHERE n.caja_id = $1
           AND n.estado_pago = 'PAGADO'
           AND n.estado <> 'CANCELADA'
        UNION ALL
        SELECT ab.forma_pago, ab.monto
          FROM nota_abonos ab
          JOIN notas n ON n.id = ab.nota_id
         WHERE ab.caja_id = $1
           AND ab.revertido_at IS NULL
           AND n.estado <> 'CANCELADA'
     )
     SELECT
        COALESCE(SUM(monto), 0) AS total,
        COALESCE(SUM(monto) FILTER (
          WHERE COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'), 0) AS efectivo,
        COALESCE(SUM(monto) FILTER (WHERE forma_pago = 'TRANSFERENCIA'), 0) AS transferencia,
        COALESCE(SUM(monto) FILTER (WHERE forma_pago = 'TARJETA'), 0) AS tarjeta
       FROM cobros`,
    [cajaId]
  );
  const r = rows[0];
  return {
    total:         parseFloat(r.total),
    efectivo:      parseFloat(r.efectivo),
    transferencia: parseFloat(r.transferencia),
    tarjeta:       parseFloat(r.tarjeta),
  };
}

/**
 * Qué se vendió en una caja, por concepto (recuadro Ingresos del corte). Cada
 * cobro, con cualquier forma de pago (mismas reglas que ventasDeSesion), se
 * reparte entre las partes de su nota en proporción a lo que vale cada una:
 * - Por Encargo: `edredon` (servicios de Edredón), `por_encargo` (los demás) y
 *   `productos` (lo que se cobra encima del servicio).
 * - Lo demás: lavadoras medianas / jumbo (por la primera máquina del hueco o el
 *   tamaño pedido; el edredón cuenta como jumbo), secadoras y productos.
 * Se trabaja en centavos y el residuo va a la parte más grande: la suma es
 * exactamente el total cobrado. Los cortes congelados antes del 2026-10-19
 * repartían solo el efectivo (ver `ingresos_solo_efectivo` en leerCortes).
 */
export async function ingresosDeSesion(client, cajaId) {
  return repartirCobros(client, `
        SELECT n.id AS nota_id,
               n.precio_total - COALESCE((
                 SELECT SUM(ab.monto) FROM nota_abonos ab
                  WHERE ab.nota_id = n.id AND ab.revertido_at IS NULL
               ), 0) AS monto
          FROM notas n
         WHERE n.caja_id = $1
           AND n.estado_pago = 'PAGADO'
           AND n.estado <> 'CANCELADA'
        UNION ALL
        SELECT ab.nota_id, ab.monto
          FROM nota_abonos ab
          JOIN notas n ON n.id = ab.nota_id
         WHERE ab.caja_id = $1
           AND ab.revertido_at IS NULL
           AND n.estado <> 'CANCELADA'`, [cajaId]);
}

/**
 * Reparte por concepto un conjunto de cobros (reglas en ingresosDeSesion).
 * @param {string} cobrosSql SELECT de (nota_id, monto), un renglón por cobro.
 */
export async function repartirCobros(client, cobrosSql, params) {
  const { rows } = await client.query(
    `WITH cobros AS (${cobrosSql}
     ),
     por_nota AS (
        SELECT nota_id, SUM(monto) AS monto FROM cobros GROUP BY nota_id
     )
     SELECT pn.monto, n.tipo_servicio,
            COALESCE(c.encargo_edredon, 0) AS edredon,
            COALESCE(c.encargo_otros, 0) AS por_encargo,
            COALESCE(c.lav_mediana, 0) AS lavadoras_medianas,
            COALESCE(c.lav_jumbo, 0)   AS lavadoras_jumbo,
            COALESCE(c.secadoras, 0)   AS secadoras,
            -- En Por Encargo solo cuenta aparte lo cobrado encima (marca, polvo y bolsas de más).
            CASE WHEN n.tipo_servicio = 'POR_ENCARGO'
                 THEN COALESCE(c.encargo_productos, 0) + COALESCE(sueltos.marca, 0)
                 ELSE COALESCE(c.productos, 0) + COALESCE(sueltos.total, 0)
            END AS productos
       FROM por_nota pn
       JOIN notas n ON n.id = pn.nota_id
       LEFT JOIN LATERAL (
         SELECT SUM(nc.precio_lavadora) FILTER (WHERE NOT t.jumbo) AS lav_mediana,
                SUM(nc.precio_lavadora) FILTER (WHERE t.jumbo)     AS lav_jumbo,
                -- La secadora con sus fichas de más (como recalcularPrecioTotal).
                SUM(nc.precio_secadora + nc.precio_fichas_extra)   AS secadoras,
                SUM(pc.todos)                                      AS productos,
                -- Lo que vale el servicio Por Encargo (como recalcularPrecioTotal).
                SUM(v.encargo) FILTER (WHERE UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON')
                                                                   AS encargo_edredon,
                SUM(v.encargo) FILTER (WHERE UPPER(COALESCE(nc.tipo_prenda, '')) <> 'EDREDON')
                                                                   AS encargo_otros,
                SUM(v.encargo_productos)                           AS encargo_productos
           FROM nota_cargas nc
           CROSS JOIN LATERAL (
             SELECT COALESCE(SUM(np.cantidad * np.precio_unitario), 0) AS todos,
                    COALESCE(SUM(np.cantidad * np.precio_unitario)
                               FILTER (WHERE a.se_vende_por_unidad), 0) AS marca
               FROM nota_productos np
               JOIN productos a ON a.id = np.producto_id
              WHERE np.carga_id = nc.id
           ) pc
           CROSS JOIN LATERAL (
             -- El servicio y, aparte, lo que se cobra encima (va a Productos).
             SELECT GREATEST(0, CASE WHEN nc.precio_tope IS NOT NULL
                                     THEN nc.precio_tope
                                     ELSE nc.precio_lavadora + nc.precio_secadora + nc.precio_fichas_extra
                                END + nc.ajuste) AS encargo,
                    CASE WHEN nc.precio_tope IS NOT NULL THEN pc.marca ELSE pc.todos END
                                                     AS encargo_productos
           ) v
           LEFT JOIN maquinas ml ON ml.id = nc.lavadora_id
           CROSS JOIN LATERAL (
             -- El edredón cuenta como jumbo en cualquier lavadora.
             SELECT COALESCE(
                      CASE WHEN UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON'
                             OR nc.lavadora_tipo = 'edredon' THEN TRUE END,
                      (SELECT p.maquina_tipo = 'lavadora_jumbo'
                         FROM nota_carga_maquinas p
                        WHERE p.carga_id = nc.id AND p.slot = 'lavadora'
                          AND p.maquina_tipo IS NOT NULL
                        ORDER BY p.asignada_at, p.id LIMIT 1),
                      ml.tipo::text = 'lavadora_jumbo',
                      nc.lavadora_tipo IN ('jumbo', 'edredon'),
                      FALSE) AS jumbo
           ) t
          WHERE nc.nota_id = n.id
       ) c ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(np.cantidad * np.precio_unitario) AS total,
                SUM(${COBRO_APARTE_ENCARGO('np', 'a', 'n')}) AS marca
           FROM nota_productos np
           JOIN productos a ON a.id = np.producto_id
          WHERE np.nota_id = n.id AND np.carga_id IS NULL
       ) sueltos ON TRUE`,
    params
  );

  const MOSTRADOR = ['productos', 'lavadoras_medianas', 'lavadoras_jumbo', 'secadoras'];
  const ENCARGO = ['por_encargo', 'edredon', 'productos'];
  const cent = {
    lavadoras_medianas: 0, lavadoras_jumbo: 0, secadoras: 0, productos: 0, edredon: 0, por_encargo: 0,
  };
  for (const r of rows) {
    const monto = Math.round(parseFloat(r.monto) * 100);
    const LINEAS = r.tipo_servicio === 'POR_ENCARGO' ? ENCARGO : MOSTRADOR;
    const partes = LINEAS.map((k) => Math.max(0, parseFloat(r[k])));
    const valor = partes.reduce((a, b) => a + b, 0);
    // Sin partes con precio (solo un ajuste): va a la primera línea del
    // servicio para que la suma cuadre.
    if (valor <= 0) { cent[LINEAS[0]] += monto; continue; }
    let repartido = 0;
    const asignado = partes.map((p) => {
      const c = Math.round((monto * p) / valor);
      repartido += c;
      return c;
    });
    asignado[partes.indexOf(Math.max(...partes))] += monto - repartido;
    LINEAS.forEach((k, i) => { cent[k] += asignado[i]; });
  }
  return Object.fromEntries(Object.entries(cent).map(([k, v]) => [k, v / 100]));
}

/**
 * "SPE Debe" del corte: saldo de las notas Por Encargo creadas en el turno que
 * siguen sin liquidar (sin canceladas).
 */
export async function porEncargoPendienteDeSesion(client, caja) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(n.precio_total - COALESCE((
              SELECT SUM(ab.monto) FROM nota_abonos ab
               WHERE ab.nota_id = n.id AND ab.revertido_at IS NULL
            ), 0)), 0) AS saldo
       FROM notas n
      WHERE n.sucursal = $1
        AND n.tipo_servicio = 'POR_ENCARGO'
        AND n.estado <> 'CANCELADA'
        AND n.estado_pago <> 'PAGADO'
        AND n.created_at >= $2
        AND n.created_at <= COALESCE($3, NOW())`,
    [caja.sucursal, caja.abierta_at, caja.cerrada_at ?? null]
  );
  return Math.max(0, parseFloat(rows[0].saldo));
}

/** Totales de entradas y gastos de una caja. */
export async function totalesMovimientos(client, cajaId) {
  const { rows } = await client.query(
    `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN monto ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN monto ELSE 0 END), 0) AS salidas
       FROM movimientos_caja
      WHERE caja_id = $1`,
    [cajaId]
  );
  return {
    entradas: parseFloat(rows[0].entradas),
    salidas:  parseFloat(rows[0].salidas),
  };
}

/**
 * Caja inicial de la próxima apertura: lo que quedó en el cajón al cerrar la
 * anterior (la caja final, o lo contado). Tras un cierre automático, lo
 * esperado (y la pantalla avisa). null si nunca se ha cerrado una caja: la
 * captura un admin. En la demo siempre null: quien abre captura el fondo.
 */
async function aperturaSugerida(client, sucursal) {
  if (ENTORNO_DEMO) return null;
  const { rows } = await client.query(
    `SELECT c.id, c.monto_inicial, c.monto_contado, c.monto_caja_final, c.cerrada_at, c.cierre_automatico,
            -- Cifras congeladas o, en cortes muy viejos, calculadas en vivo.
            COALESCE(c.ventas_efectivo, (
              SELECT COALESCE(SUM(precio_total), 0) FROM notas
               WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
                 AND COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'
            )) AS ventas_efectivo,
            COALESCE(c.total_entradas, (
              SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
               WHERE caja_id = c.id AND tipo = 'entrada'
            )) AS total_entradas,
            COALESCE(c.total_salidas, (
              SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
               WHERE caja_id = c.id AND tipo = 'salida'
            )) AS total_salidas
       FROM cajas c
      WHERE c.estado = 'cerrada' AND c.sucursal = $1
      ORDER BY c.cerrada_at DESC
      LIMIT 1`,
    [sucursal]
  );
  if (rows.length === 0) return null;

  const c = rows[0];
  const esperado = parseFloat(c.monto_inicial)
                 + parseFloat(c.ventas_efectivo)
                 + parseFloat(c.total_entradas)
                 - parseFloat(c.total_salidas);
  const contado = c.monto_contado != null ? parseFloat(c.monto_contado) : null;
  const sinConteo = contado == null;
  // Caja final; los cortes sin reparto arrastran todo lo contado.
  const cajaFinal = c.monto_caja_final != null ? parseFloat(c.monto_caja_final) : contado;

  return {
    // Nunca negativa, y redondeada a centavos (la suma de flotantes deja
    // decimales sueltos).
    monto:  Math.max(0, Math.round((sinConteo ? esperado : cajaFinal) * 100) / 100),
    origen: sinConteo ? 'cierre_automatico' : 'corte',
    corte: {
      id:            c.id,
      cerrada_at:    c.cerrada_at,
      monto_contado: contado,
      esperado,
    },
  };
}

/**
 * Caja abierta por este usuario en cualquier sucursal, o null. Impide cerrar
 * sesión sin hacer el corte aunque haya cambiado de sucursal.
 */
async function miCajaAbierta(client, usuarioId) {
  const { rows } = await client.query(
    `SELECT c.sucursal, COALESCE(s.nombre, c.sucursal) AS sucursal_nombre
       FROM cajas c
       LEFT JOIN sucursales s ON s.slug = c.sucursal
      WHERE c.estado = 'abierta' AND c.usuario_apertura_id = $1
      LIMIT 1`,
    [usuarioId]
  );
  return rows[0] ?? null;
}

export async function getCajaActual(req, res) {
  const client = await pool.connect();
  try {
    const mi_caja_abierta = await miCajaAbierta(client, req.user.id);
    const cajaRes = await client.query(
      `SELECT c.*, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_apertura
         FROM cajas c
         JOIN usuarios u ON u.id = c.usuario_apertura_id
        WHERE c.estado = 'abierta' AND c.sucursal = $1
        LIMIT 1`,
      [req.sucursal]
    );

    if (cajaRes.rowCount === 0) {
      // Sin caja abierta: con cuánto se abre la siguiente.
      return res.json({
        abierta: false,
        apertura_sugerida: await aperturaSugerida(client, req.sucursal),
        mi_caja_abierta,
      });
    }

    const caja = cajaRes.rows[0];

    const movsRes = await client.query(
      `SELECT mc.id, mc.tipo, mc.concepto, mc.monto, mc.created_at, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario
         FROM movimientos_caja mc
         JOIN usuarios u ON u.id = mc.usuario_id
        WHERE mc.caja_id = $1
        ORDER BY mc.created_at DESC`,
      [caja.id]
    );

    const ventas = await ventasDeSesion(client, caja.id);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    // El esperado solo cuenta el efectivo.
    const esperado = monto_inicial + ventas.efectivo + entradas - salidas;

    res.json({
      abierta: true,
      mi_caja_abierta,
      caja: {
        id:               caja.id,
        usuario_apertura_id: caja.usuario_apertura_id,
        usuario_apertura: caja.usuario_apertura,
        monto_inicial,
        notas_apertura:   caja.notas_apertura,
        abierta_at:       caja.abierta_at,
      },
      totales: {
        ventas: ventas.total, ventas_desglose: ventas, entradas, salidas, esperado,
        ingresos: await ingresosDeSesion(client, caja.id),
        egresos: {
          por_encargo_pendiente: await porEncargoPendienteDeSesion(client, caja),
          salidas,
        },
      },
      movimientos: movsRes.rows.map((m) => ({
        id:         m.id,
        tipo:       m.tipo,
        concepto:   m.concepto,
        monto:      parseFloat(m.monto),
        usuario:    m.usuario,
        created_at: m.created_at,
      })),
    });
  } catch (err) {
    console.error('Error en caja/actual:', err);
    res.status(500).json({ message: 'No se pudo cargar la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

/**
 * Abre la caja. La caja inicial sale del corte anterior (aperturaSugerida): el
 * empleado solo la confirma; ajustarla, o capturarla la primera vez, es de admin.
 */
export async function abrirCaja(req, res) {
  const { monto_inicial, notas } = req.body;

  const client = await pool.connect();
  try {
    // Primero la caja ya abierta, para que el mensaje diga lo que pasa.
    const abierta = await client.query(
      `SELECT 1 FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (abierta.rowCount > 0) {
      return res.status(409).json({ message: 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' });
    }

    const sugerida = await aperturaSugerida(client, req.sucursal);
    // En la demo cualquiera captura el fondo, como un admin.
    const admin = esAdmin(req.user?.rol) || ENTORNO_DEMO;

    let monto;
    if (admin) {
      // Admin: si no manda monto, va el del corte anterior.
      monto = monto_inicial === undefined || monto_inicial === null || monto_inicial === ''
        ? sugerida?.monto
        : Number(monto_inicial);
      if (monto == null) {
        return res.status(400).json({ message: 'Captura la caja inicial para abrir la caja.' });
      }
    } else {
      if (!sugerida) {
        return res.status(403).json({
          message: 'No hay un corte anterior del cual tomar el fondo. Pide a un administrador que abra la caja.',
        });
      }
      // La pantalla lo bloquea: un monto distinto viene de fuera de la app.
      if (monto_inicial !== undefined && monto_inicial !== null && monto_inicial !== ''
          && Number(monto_inicial) !== sugerida.monto) {
        return res.status(403).json({
          message: 'El fondo lo fija el corte anterior. Solo un administrador puede ajustarlo.',
        });
      }
      monto = sugerida.monto;
    }

    if (!Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ message: 'El monto inicial debe ser un número mayor o igual a 0.' });
    }

    const { rows } = await client.query(
      `INSERT INTO cajas (usuario_apertura_id, monto_inicial, notas_apertura, sucursal)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.id, monto, notas?.trim() || null, req.sucursal]
    );
    res.status(201).json({ id: rows[0].id, monto_inicial: monto });
  } catch (err) {
    // Índice único parcial: ya hay una caja abierta.
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' });
    }
    console.error('Error en caja/abrir:', err);
    res.status(500).json({ message: 'No se pudo abrir la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

export async function registrarMovimiento(req, res) {
  const { tipo, concepto, monto } = req.body;
  const cantidad = Number(monto);

  if (tipo !== 'entrada' && tipo !== 'salida') {
    return res.status(400).json({ message: 'El movimiento debe ser una entrada o una salida.' });
  }
  // El empleado solo registra gastos; las entradas son de admin.
  if (tipo === 'entrada' && !esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede registrar entradas.' });
  }
  if (!concepto?.trim()) {
    return res.status(400).json({ message: 'El concepto es obligatorio.' });
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return res.status(400).json({ message: 'El monto debe ser un número mayor a 0.' });
  }

  try {
    const cajaRes = await pool.query(
      `SELECT id FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1`,
      [req.sucursal]
    );
    if (cajaRes.rowCount === 0) {
      return res.status(409).json({ message: 'No hay una caja abierta.' });
    }
    const cajaId = cajaRes.rows[0].id;

    const { rows } = await pool.query(
      `INSERT INTO movimientos_caja (caja_id, usuario_id, tipo, concepto, monto)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [cajaId, req.user.id, tipo, concepto.trim(), cantidad]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error('Error en caja/movimientos:', err);
    res.status(500).json({ message: 'No se pudo registrar el movimiento de caja. Intenta de nuevo.' });
  }
}

export async function cerrarCaja(req, res) {
  const { monto_contado, notas_cierre, monto_caja_final, monto_sobre } = req.body;
  const contado = Number(monto_contado);

  if (!Number.isFinite(contado) || contado < 0) {
    return res.status(400).json({ message: 'El monto contado debe ser un número mayor o igual a 0.' });
  }

  // Lo contado se reparte en caja final (se queda y abre el siguiente turno) y
  // sobre (sale del cajón). Sin reparto, todo se queda en el cajón.
  const sinReparto = monto_caja_final == null && monto_sobre == null;
  const cajaFinal = sinReparto ? contado : Number(monto_caja_final);
  const sobre     = sinReparto ? 0 : Number(monto_sobre);
  if (!Number.isFinite(cajaFinal) || cajaFinal < 0 || !Number.isFinite(sobre) || sobre < 0) {
    return res.status(400).json({ message: 'La caja final y el sobre deben ser números mayores o iguales a 0.' });
  }
  if (Math.abs(cajaFinal + sobre - contado) >= 0.005) {
    return res.status(400).json({
      message: 'La caja final más el sobre tienen que sumar el efectivo contado.',
    });
  }

  const client = await pool.connect();
  try {
    // Fila bloqueada: un segundo cierre simultáneo espera y recibe 409.
    await client.query('BEGIN');

    const cajaRes = await client.query(
      `SELECT * FROM cajas WHERE estado = 'abierta' AND sucursal = $1 LIMIT 1 FOR UPDATE`,
      [req.sucursal]
    );
    if (cajaRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'No hay una caja abierta.' });
    }
    const caja = cajaRes.rows[0];

    // Cada caja es el turno de quien la abrió: el corte lo hace esa persona o
    // un administrador.
    if (String(caja.usuario_apertura_id) !== String(req.user.id) && !esAdmin(req.user.rol)) {
      await client.query('ROLLBACK');
      const { rows: ab } = await client.query(
        `SELECT TRIM(nombre || ' ' || COALESCE(apellido, '')) AS nombre FROM usuarios WHERE id = $1`,
        [caja.usuario_apertura_id]
      );
      const quien = ab[0]?.nombre || 'otra persona';
      return res.status(403).json({
        message: `Este turno lo abrió ${quien}: solo esa persona o un administrador puede hacer el corte.`,
      });
    }

    const ventas = await ventasDeSesion(client, caja.id);
    const { entradas, salidas } = await totalesMovimientos(client, caja.id);
    const monto_inicial = parseFloat(caja.monto_inicial);
    // El esperado solo cuenta el efectivo.
    const esperado = monto_inicial + ventas.efectivo + entradas - salidas;
    const diferencia = contado - esperado;
    // Ingresos por concepto y SPE Debe se congelan con lo demás.
    const ingresos = await ingresosDeSesion(client, caja.id);
    const speDebe  = await porEncargoPendienteDeSesion(client, caja);

    // Las cifras se copian al corte: lo que pase después con esas notas no
    // reescribe un corte cerrado.
    const upd = await client.query(
      `UPDATE cajas
          SET estado = 'cerrada',
              usuario_cierre_id = $1,
              monto_contado = $2,
              notas_cierre = $3,
              cerrada_at = NOW(),
              ventas_total         = $5,
              ventas_efectivo      = $6,
              ventas_transferencia = $7,
              ventas_tarjeta       = $8,
              total_entradas       = $9,
              total_salidas        = $10,
              monto_caja_final     = $11,
              monto_sobre          = $12,
              ingresos_detalle     = $13,
              spe_debe             = $14
        WHERE id = $4 AND estado = 'abierta'`,
      [req.user.id, contado, notas_cierre?.trim() || null, caja.id,
       ventas.total, ventas.efectivo, ventas.transferencia, ventas.tarjeta,
       entradas, salidas, cajaFinal, sobre, JSON.stringify(ingresos), speDebe]
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'La caja ya fue cerrada por alguien más.' });
    }

    await client.query('COMMIT');

    res.json({
      id: caja.id,
      resumen: {
        monto_inicial,
        ventas: ventas.total,
        ventas_desglose: ventas,
        entradas,
        salidas,
        esperado,
        contado,
        diferencia,
        caja_final: cajaFinal,
        sobre,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en caja/cerrar:', err);
    res.status(500).json({ message: 'No se pudo cerrar la caja. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

/**
 * Turnos de caja que cumplen `where` (SQL sobre `c`, con `params`), listos para
 * pintar y exportar (historial de Caja y Ventas).
 * - Cerrado: sus cifras congeladas. Sin reparto congelado, se recalcula; sin
 *   SPE Debe congelado, queda null.
 * - Abierto: en vivo, con `en_curso: true`.
 */
export async function leerCortes(client, where, params) {
  const { rows } = await client.query(
    `SELECT
          c.id,
          c.monto_inicial,
          c.monto_contado,
          c.monto_caja_final,
          c.monto_sobre,
          c.notas_apertura,
          c.notas_cierre,
          c.abierta_at,
          c.cerrada_at,
          c.cierre_automatico,
          c.estado,
          c.sucursal,
          c.ingresos_detalle,
          c.spe_debe,
          TRIM(ua.nombre || ' ' || COALESCE(ua.apellido, '')) AS usuario_apertura,
          TRIM(uc.nombre || ' ' || COALESCE(uc.apellido, '')) AS usuario_cierre,
          -- Cifras congeladas al cerrar; en cortes muy viejos sin copia, se
          -- suman desde sus notas.
          COALESCE(c.ventas_total, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
          )) AS ventas,
          COALESCE(c.ventas_efectivo, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND COALESCE(forma_pago, 'EFECTIVO') = 'EFECTIVO'
          )) AS ventas_efectivo,
          COALESCE(c.ventas_transferencia, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND forma_pago = 'TRANSFERENCIA'
          )) AS ventas_transferencia,
          COALESCE(c.ventas_tarjeta, (
            SELECT COALESCE(SUM(precio_total), 0) FROM notas
             WHERE caja_id = c.id AND estado_pago = 'PAGADO' AND estado <> 'CANCELADA'
               AND forma_pago = 'TARJETA'
          )) AS ventas_tarjeta,
          COALESCE(c.total_entradas, (
            SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'entrada'
          )) AS entradas,
          COALESCE(c.total_salidas, (
            SELECT COALESCE(SUM(monto), 0) FROM movimientos_caja
             WHERE caja_id = c.id AND tipo = 'salida'
          )) AS salidas,
          -- Entradas y gastos del turno con su concepto.
          (SELECT COALESCE(json_agg(json_build_object(
                    'id', mc.id, 'tipo', mc.tipo, 'concepto', mc.concepto,
                    'monto', mc.monto, 'created_at', mc.created_at,
                    'usuario', TRIM(um.nombre || ' ' || COALESCE(um.apellido, ''))
                  ) ORDER BY mc.created_at), '[]'::json)
             FROM movimientos_caja mc
             JOIN usuarios um ON um.id = mc.usuario_id
            WHERE mc.caja_id = c.id) AS movimientos
        FROM cajas c
        JOIN usuarios ua ON ua.id = c.usuario_apertura_id
        LEFT JOIN usuarios uc ON uc.id = c.usuario_cierre_id
       WHERE ${where}
       ORDER BY COALESCE(c.cerrada_at, NOW()) DESC`,
    params
  );

  const cortes = [];
  for (const r of rows) {
    const en_curso = r.estado === 'abierta';
    const monto_inicial = parseFloat(r.monto_inicial);
    let ventas_desglose;
    let entradas;
    let salidas;
    if (en_curso) {
      ventas_desglose = await ventasDeSesion(client, r.id);
      ({ entradas, salidas } = await totalesMovimientos(client, r.id));
    } else {
      ventas_desglose = {
        total:         parseFloat(r.ventas),
        efectivo:      parseFloat(r.ventas_efectivo),
        transferencia: parseFloat(r.ventas_transferencia),
        tarjeta:       parseFloat(r.ventas_tarjeta),
      };
      entradas = parseFloat(r.entradas);
      salidas  = parseFloat(r.salidas);
    }
    const ventas   = ventas_desglose.total;
    const esperado = monto_inicial + ventas_desglose.efectivo + entradas - salidas;
    const contado  = r.monto_contado != null ? parseFloat(r.monto_contado) : null;
    const ingresos = !en_curso && r.ingresos_detalle
      ? r.ingresos_detalle
      : await ingresosDeSesion(client, r.id);
    // Congelado cuando el reparto era solo del efectivo: suma el efectivo y no
    // el total (el reparto cuadra al centavo).
    const sumaIngresos = Object.values(ingresos).reduce((a, v) => a + Number(v || 0), 0);
    const ingresos_solo_efectivo = Math.abs(ventas - ventas_desglose.efectivo) >= 0.005
      && Math.abs(sumaIngresos - ventas_desglose.efectivo) < 0.005;
    const spe_debe = en_curso
      ? await porEncargoPendienteDeSesion(client, r)
      : (r.spe_debe != null ? parseFloat(r.spe_debe) : null);
    cortes.push({
      id:               r.id,
      en_curso,
      usuario_apertura: r.usuario_apertura,
      usuario_cierre:   r.usuario_cierre,
      abierta_at:        r.abierta_at,
      cerrada_at:        r.cerrada_at,
      // Cerrada a medianoche sin conteo: la pantalla lo dice.
      cierre_automatico: r.cierre_automatico,
      notas_apertura:   r.notas_apertura,
      notas_cierre:     r.notas_cierre,
      monto_inicial,
      ventas,
      ventas_desglose,
      entradas,
      salidas,
      esperado,
      contado,
      diferencia: contado != null ? contado - esperado : null,
      // Reparto de lo contado; null en cierres automáticos.
      caja_final: r.monto_caja_final != null ? parseFloat(r.monto_caja_final) : null,
      sobre:      r.monto_sobre != null ? parseFloat(r.monto_sobre) : null,
      // Ingresos por concepto y SPE Debe.
      ingresos,
      ingresos_solo_efectivo,
      spe_debe,
      movimientos: (r.movimientos ?? []).map((m) => ({ ...m, monto: parseFloat(m.monto) })),
    });
  }
  return cortes;
}

export async function getHistorial(req, res) {
  try {
    res.json(await leerCortes(pool, `c.estado = 'cerrada' AND c.sucursal = $1`, [req.sucursal]));
  } catch (err) {
    console.error('Error en caja/historial:', err);
    res.status(500).json({ message: 'No se pudo cargar el historial de cortes. Intenta de nuevo.' });
  }
}

// ── DELETE /caja/historial/:id ──────────────────────────────
/** Elimina un corte cerrado del historial (admin); sus movimientos van en cascada. */
export async function eliminarCorte(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'No se reconoció el corte.' });

  try {
    const { rows } = await pool.query(
      `DELETE FROM cajas
        WHERE id = $1 AND sucursal = $2 AND estado = 'cerrada'
        RETURNING id`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Corte no encontrado o aún abierto.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Error al eliminar corte:', err);
    res.status(500).json({ message: 'No se pudo eliminar el corte. Intenta de nuevo.' });
  }
}
