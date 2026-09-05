import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';
import { esFechaISO } from '../utils/tz.js';

// Para productos por tapa/medida el mínimo se lleva por producto (en tapas);
// para los demás se usa el mínimo global de Ajustes.
const ESTADO_STOCK_SQL = `
  CASE
    WHEN (stock_actual - stock_reservado) = 0
      THEN 'agotado'
    WHEN (stock_actual - stock_reservado) <= (
           CASE WHEN es_por_tapa OR clase = 'bolsa'
                THEN stock_minimo
                ELSE (SELECT stock_minimo_global FROM ajustes WHERE id = 1)
           END)
      THEN 'por_agotarse'
    ELSE 'ok'
  END AS estado_stock
`.trim();

// Campos derivados que necesita el frontend para mostrar botellas/bidones:
//   tapas_por_botella  = floor(botella_ml / tapa_ml)
//   botellas_por_bidon = floor(volumen_envase_ml / botella_ml)   (volumen_envase_ml = mL del bidón)
const DERIVADOS_SQL = `
  CASE WHEN botella_ml > 0 AND tapa_ml > 0
       THEN floor(botella_ml::numeric / tapa_ml) END AS tapas_por_botella,
  CASE WHEN volumen_envase_ml > 0 AND botella_ml > 0
       THEN floor(volumen_envase_ml::numeric / botella_ml) END AS botellas_por_bidon
`.trim();

// Estado del líquido a granel (bidón): agotado cuando no queda nada, por
// agotarse cuando queda menos de un bidón lleno. Solo aplica a productos granel.
const ESTADO_GRANEL_SQL = `
  CASE WHEN tipo_liquido = 'granel' THEN
    CASE
      WHEN stock_granel_tapas <= 0 THEN 'agotado'
      WHEN stock_minimo_granel > 0 AND stock_granel_tapas <= stock_minimo_granel THEN 'por_agotarse'
      ELSE 'ok'
    END
  END AS estado_granel
`.trim();

// SELECT estándar de un producto con sus campos calculados.
const SELECT_PRODUCTO = `*,
              (stock_actual - stock_reservado) AS stock_disponible,
              ${DERIVADOS_SQL},
              ${ESTADO_STOCK_SQL},
              ${ESTADO_GRANEL_SQL}`;

// Resuelve el tamaño de la tapa (mL). Si no se dio explícito, se deriva de
// "cuántas tapas salen de una botella" (aprox): tapa_ml = floor(botella_ml / N).
function resolverTapaMl(tapaMl, tapasPorBotella, botellaMl) {
  const explicito = Number(tapaMl) || 0;
  if (explicito > 0) return explicito;
  const n = Number(tapasPorBotella) || 0;
  if (n > 0 && botellaMl > 0) return Math.max(1, Math.floor(botellaMl / n));
  return 0;
}

// Cuántas unidades de stock representa una "unidad" dada.
//   Líquidos (stock en tapas): tapa → 1 · botella → tapas/botella · bidon → tapas/bidón.
//   Bolsas (stock en piezas):  pieza → 1 · rollo → bolsas por rollo.
function tapasDeUnidad(unidad, p) {
  if (unidad === 'pieza') return 1;
  if (unidad === 'rollo') return Number(p.bolsas_por_rollo) || 0;
  const tapaMl    = Number(p.tapa_ml) || 0;
  const botellaMl = Number(p.botella_ml) || 0;
  const bidonMl   = Number(p.volumen_envase_ml) || 0;
  if (unidad === 'tapa')    return 1;
  if (unidad === 'botella') return tapaMl > 0 ? Math.floor(botellaMl / tapaMl) : 0;
  if (unidad === 'bidon')   return tapaMl > 0 ? Math.floor(bidonMl / tapaMl) : 0;
  return 0;
}

// Inserta una fila en el historial de movimientos de stock.
async function registrarMovimiento(client, {
  productoId, sucursal, usuarioId, tipo, destino, cantidadTapas,
  descripcion = null, notaId = null,
}) {
  await client.query(
    `INSERT INTO producto_movimientos
       (producto_id, sucursal, usuario_id, tipo, destino, cantidad_tapas, descripcion, nota_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [productoId, sucursal, usuarioId ?? null, tipo, destino, cantidadTapas, descripcion, notaId]
  );
}

export const getProductos = async (req, res) => {
  // Por defecto solo productos activos; con ?archivados=1 devuelve los archivados
  // (para la vista de "ver archivados / restaurar").
  const soloArchivados = req.query.archivados === '1';
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_PRODUCTO}
       FROM productos
       WHERE sucursal = $1 AND archivado = $2
       ORDER BY CASE WHEN tipo_liquido = 'granel' THEN 0
                     WHEN tipo_liquido = 'marca'  THEN 1
                     ELSE 2 END,
                nombre ASC`,
      [req.sucursal, soloArchivados]
    );
    res.json(rows);
  } catch (err) {
    console.error('getProductos error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los productos. Intenta de nuevo.' });
  }
};

// Archivar (ocultar) o restaurar un producto. Solo admin. No borra nada: el
// producto sigue existiendo para el historial de las notas viejas.
export const archivarProducto = async (req, res) => {
  const { id } = req.params;
  const archivado = req.body?.archivado !== false; // por defecto archiva
  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET archivado = $1, updated_at = NOW()
       WHERE id = $2 AND sucursal = $3
       RETURNING ${SELECT_PRODUCTO}`,
      [archivado, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('archivarProducto error:', err);
    res.status(500).json({ message: 'No se pudo archivar el producto. Intenta de nuevo.' });
  }
};

// Crea una bolsa: producto (clase='bolsa') contado en piezas. Nace en 0; la
// existencia se carga con una entrada (por rollo o por pieza).
async function crearBolsa(req, res, { nombre, descripcion, marca, tamano_bolsa, bolsas_por_rollo, precio_unitario, stock_minimo }) {
  if (!['chica', 'grande', 'jumbo'].includes(tamano_bolsa)) {
    return res.status(400).json({ message: 'Elige el tamaño de la bolsa: chica, grande o jumbo.' });
  }
  const porRollo = Number(bolsas_por_rollo);
  if (!(porRollo > 0)) {
    return res.status(400).json({ message: 'Indica cuántas bolsas trae un rollo.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO productos
         (nombre, descripcion, unidad, precio_unitario, stock_actual, marca, sucursal,
          clase, tamano_bolsa, bolsas_por_rollo, es_por_tapa, stock_minimo)
       VALUES ($1, $2, 'pieza', $3, 0, $4, $5, 'bolsa', $6, $7, false, $8)
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, precio_unitario ?? null, marca || null, req.sucursal,
       tamano_bolsa, Math.round(porRollo), Number(stock_minimo) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('crearBolsa error:', err);
    res.status(500).json({ message: 'No se pudieron guardar las bolsas. Intenta de nuevo.' });
  }
}

export const createProducto = async (req, res) => {
  const {
    nombre, descripcion, unidad = 'Tapas', precio_unitario, marca,
    clase = 'liquido', tipo_liquido = 'granel', envase, stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, tapa_ml, tapas_por_botella, precio_botella,
    // Bolsas:
    tamano_bolsa, bolsas_por_rollo,
    // Existencias iniciales: botellas rellenadas y (granel) bidones a granel.
    stock_botellas = 0, stock_bidones = 0,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Escribe el nombre del producto.' });
  }

  // ── Bolsa: producto simple contado en piezas, comprado por rollo ──
  if (clase === 'bolsa') {
    return crearBolsa(req, res, {
      nombre, descripcion, marca, tamano_bolsa, bolsas_por_rollo,
      precio_unitario, stock_minimo,
    });
  }

  if (!['granel', 'marca'].includes(tipo_liquido)) {
    return res.status(400).json({ message: 'Indica si el producto es a granel o de marca.' });
  }
  const botellaMl = Number(botella_ml);
  if (!(botellaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la botella (mL).' });
  }
  // La tapa se puede dar por tamaño (mL) o por cuántas tapas rinde una botella.
  const tapaMl = resolverTapaMl(tapa_ml, tapas_por_botella, botellaMl);
  if (!(tapaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la tapa (mL) o cuántas tapas salen de una botella.' });
  }
  if (tipo_liquido === 'granel' && (!volumen_envase_ml || Number(volumen_envase_ml) <= 0)) {
    return res.status(400).json({ message: 'Indica el volumen del bidón (mL).' });
  }

  const bidonMl   = tipo_liquido === 'granel' ? Number(volumen_envase_ml) : null;
  const tapasPorBotella = Math.floor(botellaMl / tapaMl);
  const tapasPorBidon   = bidonMl ? Math.floor(bidonMl / tapaMl) : 0;
  const tapasPorEnvase  = tipo_liquido === 'granel' ? tapasPorBidon : tapasPorBotella;

  // El stock se guarda en TAPAS: rellenadas (stock_actual) y a granel (bidón).
  const stockActual = Math.round((Number(stock_botellas) || 0) * tapasPorBotella);
  const stockGranel = Math.round((Number(stock_bidones)  || 0) * tapasPorBidon);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO productos
         (nombre, descripcion, unidad, precio_unitario, precio_botella, stock_actual,
          stock_granel_tapas, marca, sucursal, tipo_liquido, es_por_tapa, tapas_por_envase,
          envase, stock_minimo, stock_minimo_granel, volumen_envase_ml, botella_ml, tapa_ml)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14, $15, $16, $17)
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, precio_botella ?? null,
       stockActual, stockGranel, marca || null, req.sucursal, tipo_liquido, tapasPorEnvase,
       envase || null, Number(stock_minimo) || 0,
       tipo_liquido === 'granel' ? (Number(stock_minimo_granel) || 0) : 0,
       bidonMl, botellaMl, tapaMl]
    );
    const prod = rows[0];
    // Semilla del historial: registra las existencias iniciales como entradas.
    if (stockGranel > 0) {
      await registrarMovimiento(client, {
        productoId: prod.id, sucursal: req.sucursal, usuarioId: req.user?.id,
        tipo: 'entrada', destino: 'granel', cantidadTapas: stockGranel,
        descripcion: `${Number(stock_bidones)} bidón(es) inicial(es)`,
      });
    }
    if (stockActual > 0) {
      await registrarMovimiento(client, {
        productoId: prod.id, sucursal: req.sucursal, usuarioId: req.user?.id,
        tipo: 'entrada', destino: 'botellas', cantidadTapas: stockActual,
        descripcion: `${Number(stock_botellas)} botella(s) inicial(es)`,
      });
    }
    await client.query('COMMIT');
    res.status(201).json(prod);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createProducto error:', err);
    res.status(500).json({ message: 'No se pudo crear el producto. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// Edita los ATRIBUTOS del producto (nombre, precios, volúmenes, etc.). Solo
// admin. El stock ya NO se cambia aquí: se mueve con las acciones de
// entrada / salida / rellenar (que quedan en el historial).
export const updateProducto = async (req, res) => {
  const { id } = req.params;
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede editar el producto.' });
  }

  const {
    nombre, descripcion, unidad = 'Tapas', precio_unitario, marca,
    clase = 'liquido', tipo_liquido = 'granel', envase, stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, tapa_ml, tapas_por_botella, precio_botella,
    tamano_bolsa, bolsas_por_rollo,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Escribe el nombre del producto.' });
  }

  // ── Bolsa: solo atributos (tamaño, bolsas por rollo, precio por pieza) ──
  if (clase === 'bolsa') {
    if (!['chica', 'grande', 'jumbo'].includes(tamano_bolsa)) {
      return res.status(400).json({ message: 'Elige el tamaño de la bolsa: chica, grande o jumbo.' });
    }
    const porRollo = Number(bolsas_por_rollo);
    if (!(porRollo > 0)) {
      return res.status(400).json({ message: 'Indica cuántas bolsas trae un rollo.' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE productos
           SET nombre = $1, descripcion = $2, precio_unitario = $3, marca = $4,
               tamano_bolsa = $5, bolsas_por_rollo = $6, stock_minimo = $7, updated_at = NOW()
         WHERE id = $8 AND sucursal = $9
         RETURNING ${SELECT_PRODUCTO}`,
        [nombre, descripcion || null, precio_unitario ?? null, marca || null,
         tamano_bolsa, Math.round(porRollo), Number(stock_minimo) || 0, id, req.sucursal]
      );
      if (rows.length === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
      return res.json(rows[0]);
    } catch (err) {
      console.error('updateProducto (bolsa) error:', err);
      return res.status(500).json({ message: 'No se pudieron guardar los cambios de la bolsa. Intenta de nuevo.' });
    }
  }

  if (!['granel', 'marca'].includes(tipo_liquido)) {
    return res.status(400).json({ message: 'Indica si el producto es a granel o de marca.' });
  }
  const botellaMl = Number(botella_ml);
  if (!(botellaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la botella (mL).' });
  }
  const tapaMl = resolverTapaMl(tapa_ml, tapas_por_botella, botellaMl);
  if (!(tapaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la tapa (mL) o cuántas tapas salen de una botella.' });
  }
  if (tipo_liquido === 'granel' && (!volumen_envase_ml || Number(volumen_envase_ml) <= 0)) {
    return res.status(400).json({ message: 'Indica el volumen del bidón (mL).' });
  }

  const bidonMl   = tipo_liquido === 'granel' ? Number(volumen_envase_ml) : null;
  const tapasPorEnvase = tipo_liquido === 'granel'
    ? Math.floor(bidonMl / tapaMl)
    : Math.floor(botellaMl / tapaMl);

  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET nombre = $1, descripcion = $2, unidad = $3, precio_unitario = $4,
             precio_botella = $5, marca = $6, tipo_liquido = $7, tapas_por_envase = $8,
             envase = $9, stock_minimo = $10, stock_minimo_granel = $11, volumen_envase_ml = $12,
             botella_ml = $13, tapa_ml = $14, es_por_tapa = true, updated_at = NOW()
       WHERE id = $15 AND sucursal = $16
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, precio_botella ?? null,
       marca || null, tipo_liquido, tapasPorEnvase, envase || null, Number(stock_minimo) || 0,
       tipo_liquido === 'granel' ? (Number(stock_minimo_granel) || 0) : 0,
       bidonMl, botellaMl, tapaMl, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateProducto error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios del producto. Intenta de nuevo.' });
  }
};

// ── POST /productos/:id/rellenar ────────────────────────────────
// Rellena N botellas desde el bidón (solo granel). Mueve N×tapas_por_botella
// de "a granel" a "rellenadas". Topa N a lo que alcance el líquido a granel.
export const rellenarBotellas = async (req, res) => {
  const { id } = req.params;
  const botellas = Number(req.body?.botellas);

  if (!Number.isInteger(botellas) || botellas <= 0) {
    return res.status(400).json({ message: 'Indica cuántas botellas rellenaste (un número entero mayor a 0).' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    const p = rows[0];
    if (p.tipo_liquido !== 'granel') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo los productos a granel se rellenan desde un bidón.' });
    }
    const tapasPorBotella = tapasDeUnidad('botella', p);
    if (tapasPorBotella <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El producto no tiene bien definidos los tamaños de botella y tapa.' });
    }
    const maxBotellas = Math.floor(Number(p.stock_granel_tapas) / tapasPorBotella);
    if (botellas > maxBotellas) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Solo alcanza para ${maxBotellas} botella(s) con el líquido a granel disponible.` });
    }
    const tapas = botellas * tapasPorBotella;
    const { rows: upd } = await client.query(
      `UPDATE productos
         SET stock_granel_tapas = stock_granel_tapas - $1,
             stock_actual = stock_actual + $1,
             updated_at = NOW()
       WHERE id = $2 AND sucursal = $3
       RETURNING ${SELECT_PRODUCTO}`,
      [tapas, id, req.sucursal]
    );
    await registrarMovimiento(client, {
      productoId: p.id, sucursal: req.sucursal, usuarioId: req.user?.id,
      tipo: 'rellenar', destino: 'botellas', cantidadTapas: tapas,
      descripcion: `${botellas} botella(s)`,
    });
    await client.query('COMMIT');
    res.json(upd[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('rellenarBotellas error:', err);
    res.status(500).json({ message: 'No se pudo registrar el rellenado. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── POST /productos/:id/movimiento ──────────────────────────────
// Entrada o salida manual de stock. destino: 'granel' (bidón) o 'botellas'.
// unidad: 'bidon' | 'botella' | 'tapa' (se convierte a tapas).
export const crearMovimiento = async (req, res) => {
  const { id } = req.params;
  const { tipo, destino, cantidad, unidad } = req.body;

  if (!['entrada', 'salida'].includes(tipo)) {
    return res.status(400).json({ message: 'El movimiento debe ser una entrada o una salida.' });
  }
  if (!['granel', 'botellas', 'piezas'].includes(destino)) {
    return res.status(400).json({ message: 'Indica a dónde va el movimiento: granel, botellas o piezas.' });
  }
  if (!['bidon', 'botella', 'tapa', 'rollo', 'pieza'].includes(unidad)) {
    return res.status(400).json({ message: 'Elige una unidad válida: bidón, botella, tapa, rollo o pieza.' });
  }
  const cant = Number(cantidad);
  if (!(cant > 0)) {
    return res.status(400).json({ message: 'La cantidad debe ser mayor a 0.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM productos WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    const p = rows[0];
    if (destino === 'granel' && p.tipo_liquido !== 'granel') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Este producto no maneja existencia a granel.' });
    }
    const tapasPorUnidad = tapasDeUnidad(unidad, p);
    if (tapasPorUnidad <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Faltan datos del producto (tamaños o bolsas por rollo) para registrar el movimiento. Revísalos en su edición.' });
    }
    const tapas = Math.round(cant * tapasPorUnidad);
    const columna = destino === 'granel' ? 'stock_granel_tapas' : 'stock_actual';
    const delta = tipo === 'entrada' ? tapas : -tapas;

    // En salidas, valida que haya existencia suficiente (no negativa; en botellas
    // respeta lo reservado por notas).
    if (tipo === 'salida') {
      const disponible = destino === 'granel'
        ? Number(p.stock_granel_tapas)
        : Number(p.stock_actual) - Number(p.stock_reservado);
      if (tapas > disponible) {
        await client.query('ROLLBACK');
        // Muestra lo disponible en la unidad que el empleado eligió.
        const dispUnidad = Math.floor(disponible / tapasPorUnidad);
        const uni = unidad === 'bidon' ? 'bidón(es)' : unidad === 'rollo' ? 'rollo(s)'
          : unidad === 'pieza' ? 'bolsa(s)' : unidad === 'botella' ? 'botella(s)' : 'tapa(s)';
        return res.status(400).json({ message: `No hay suficiente existencia para esa salida: quedan ${dispUnidad} ${uni} disponibles.` });
      }
    }

    const { rows: upd } = await client.query(
      `UPDATE productos SET ${columna} = ${columna} + $1, updated_at = NOW()
        WHERE id = $2 AND sucursal = $3
        RETURNING ${SELECT_PRODUCTO}`,
      [delta, id, req.sucursal]
    );
    const unidadTxt = unidad === 'bidon'
      ? 'bidón(es)'
      : unidad === 'rollo'
        ? 'rollo(s)'
        : unidad === 'pieza'
          ? 'bolsa(s)'
          : unidad === 'botella'
            ? (p.tipo_liquido === 'marca' ? 'unidad(es)' : 'botella(s)')
            : 'tapa(s)';
    await registrarMovimiento(client, {
      productoId: p.id, sucursal: req.sucursal, usuarioId: req.user?.id,
      tipo, destino, cantidadTapas: tapas,
      descripcion: `${cant} ${unidadTxt}`,
    });
    await client.query('COMMIT');
    res.json(upd[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('crearMovimiento error:', err);
    res.status(500).json({ message: 'No se pudo registrar el movimiento de inventario. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── GET /productos/:id/movimientos ──────────────────────────────
// Historial de movimientos de un producto (más reciente primero).
export const getMovimientos = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT m.*, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre
         FROM producto_movimientos m
         LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.producto_id = $1 AND m.sucursal = $2
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 200`,
      [id, req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getMovimientos error:', err);
    res.status(500).json({ message: 'No se pudo cargar el historial del producto. Intenta de nuevo.' });
  }
};

// ── GET /productos/reporte-diario?fecha=YYYY-MM-DD ──────────────
// Reporte para el admin: por producto líquido (granel/marca), cuánto SALIÓ ese
// día (ventas/consumo en notas) y cuánto QUEDA al cierre del día.
//
// El stock se lleva en TAPAS. La existencia al cierre de un día se reconstruye
// desde la existencia actual (exacta) restando los movimientos posteriores al
// cierre — no se necesita una "foto" diaria. Efecto de cada movimiento sobre
// cada existencia (botellas rellenadas = stock_actual, bidón = stock_granel):
//   entrada  → + en su destino;   salida → − en su destino;
//   rellenar → + botellas y − granel (transferencia bidón→botellas);
//   venta    → − botellas;        liberacion → + botellas (devolución al anular).
// El día se acota en hora local (America/Mexico_City), no en UTC del servidor.
export const getReporteDiario = async (req, res) => {
  const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  // esFechaISO además de la forma comprueba que el día exista: '2026-99-99'
  // pasaba el filtro anterior y reventaba al convertirlo a ::date.
  const fecha = esFechaISO(req.query.fecha) ? req.query.fecha : hoyMx;

  try {
    const { rows } = await pool.query(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp        AT TIME ZONE 'America/Mexico_City' AS inicio,
                (($2::date + 1))::timestamp   AT TIME ZONE 'America/Mexico_City' AS cierre
       )
       SELECT
         p.id, p.nombre, p.marca, p.tipo_liquido,
         CASE WHEN p.botella_ml > 0 AND p.tapa_ml > 0
              THEN floor(p.botella_ml::numeric / p.tapa_ml) END        AS tapas_por_botella,
         CASE WHEN p.volumen_envase_ml > 0 AND p.tapa_ml > 0
              THEN floor(p.volumen_envase_ml::numeric / p.tapa_ml) END AS tapas_por_bidon,
         p.stock_actual,
         p.stock_granel_tapas,
         -- Vendido/consumido en notas ese día (siempre sale de las botellas).
         COALESCE((
           SELECT SUM(m.cantidad_tapas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'venta'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS vendido_tapas,
         -- Efecto sobre botellas de lo ocurrido DESPUÉS del cierre (para revertir).
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada'    AND m.destino = 'botellas' THEN  m.cantidad_tapas
             WHEN m.tipo = 'salida'     AND m.destino = 'botellas' THEN -m.cantidad_tapas
             WHEN m.tipo = 'rellenar'                              THEN  m.cantidad_tapas
             WHEN m.tipo = 'venta'      AND m.destino = 'botellas' THEN -m.cantidad_tapas
             WHEN m.tipo = 'liberacion' AND m.destino = 'botellas' THEN  m.cantidad_tapas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.cierre
         ), 0) AS efecto_botellas_post,
         -- Efecto sobre el bidón (granel) posterior al cierre.
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada' AND m.destino = 'granel' THEN  m.cantidad_tapas
             WHEN m.tipo = 'salida'  AND m.destino = 'granel' THEN -m.cantidad_tapas
             WHEN m.tipo = 'rellenar'                         THEN -m.cantidad_tapas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.cierre
         ), 0) AS efecto_granel_post
       FROM productos p
       WHERE p.sucursal = $1 AND p.archivado = false
         AND p.tipo_liquido IN ('granel', 'marca')
       ORDER BY (CASE WHEN p.tipo_liquido = 'granel' THEN 0 ELSE 1 END),
                p.marca NULLS LAST, p.nombre ASC`,
      [req.sucursal, fecha]
    );

    const int = (v) => parseInt(v, 10) || 0;
    res.json({
      fecha,
      productos: rows.map((r) => ({
        id:                r.id,
        nombre:            r.nombre,
        marca:             r.marca,
        tipo_liquido:      r.tipo_liquido,
        tapas_por_botella: r.tapas_por_botella != null ? int(r.tapas_por_botella) : null,
        tapas_por_bidon:   r.tapas_por_bidon != null ? int(r.tapas_por_bidon) : null,
        vendido_tapas:     int(r.vendido_tapas),
        // La existencia no puede ser negativa; se acota a 0 por si hay datos raros.
        fin_botellas_tapas: Math.max(0, int(r.stock_actual) - int(r.efecto_botellas_post)),
        fin_granel_tapas:   Math.max(0, int(r.stock_granel_tapas) - int(r.efecto_granel_post)),
      })),
    });
  } catch (err) {
    console.error('getReporteDiario error:', err);
    res.status(500).json({ message: 'No se pudo generar el reporte del día. Intenta de nuevo.' });
  }
};

// Borrado múltiple (solo admin). Igual que en clientes, con dos modos según
// `confirmar`:
//   • confirmar = false → verificación (dry-run): no borra; devuelve los
//     productos con ventas registradas (bloqueados) y los ids eliminables.
//   • confirmar = true  → borra los eliminables (omite los bloqueados) en una
//     transacción.
// Un producto referenciado en nota_productos (con ventas) no se puede borrar
// por la restricción de llave foránea. Todo acotado a la sucursal.
export const deleteProductosMultiples = async (req, res) => {
  const { ids, confirmar } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No se recibieron productos a eliminar.' });
  }
  const idsNum = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (idsNum.length === 0) {
    return res.status(400).json({ message: 'No se entendió la lista de productos a eliminar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: productos } = await client.query(
      'SELECT id, nombre FROM productos WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [idsNum, req.sucursal]
    );
    const idsValidos = productos.map((p) => p.id);

    // Productos con ventas registradas: no se pueden borrar.
    let bloqueadosSet = new Set();
    if (idsValidos.length > 0) {
      const { rows } = await client.query(
        'SELECT DISTINCT producto_id FROM nota_productos WHERE producto_id = ANY($1)',
        [idsValidos]
      );
      bloqueadosSet = new Set(rows.map((r) => r.producto_id));
    }

    const bloqueados  = productos.filter((p) => bloqueadosSet.has(p.id));
    const eliminables = productos.filter((p) => !bloqueadosSet.has(p.id));

    if (!confirmar) {
      await client.query('ROLLBACK');
      return res.json({ bloqueados, eliminables: eliminables.map((p) => p.id) });
    }

    let eliminados = [];
    if (eliminables.length > 0) {
      const { rows } = await client.query(
        'DELETE FROM productos WHERE id = ANY($1) AND sucursal = $2 RETURNING id',
        [eliminables.map((p) => p.id), req.sucursal]
      );
      eliminados = rows.map((r) => r.id);
    }
    await client.query('COMMIT');
    res.json({ eliminados, bloqueados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteProductosMultiples error:', err);
    res.status(500).json({ message: 'No se pudieron eliminar los productos. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

export const deleteProducto = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM productos WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('deleteProducto error:', err);
    res.status(500).json({ message: 'No se pudo eliminar el producto. Intenta de nuevo.' });
  }
};
