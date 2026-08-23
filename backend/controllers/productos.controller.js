import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Para productos por tapa/medida el mínimo se lleva por producto (en tapas);
// para los demás se usa el mínimo global de Ajustes.
const ESTADO_STOCK_SQL = `
  CASE
    WHEN (stock_actual - stock_reservado) = 0
      THEN 'agotado'
    WHEN (stock_actual - stock_reservado) <= (
           CASE WHEN es_por_tapa
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

// Tapas que representa una unidad dada, según los volúmenes del producto.
//   tapa → 1 · botella → tapas_por_botella · bidon → tapas del bidón completo.
function tapasDeUnidad(unidad, p) {
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createProducto = async (req, res) => {
  const {
    nombre, descripcion, unidad = 'Tapas', precio_unitario, marca,
    tipo_liquido = 'granel', envase, stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, tapa_ml, tapas_por_botella, precio_botella,
    // Existencias iniciales: botellas rellenadas y (granel) bidones a granel.
    stock_botellas = 0, stock_bidones = 0,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }
  if (!['granel', 'marca'].includes(tipo_liquido)) {
    return res.status(400).json({ message: 'Tipo de líquido inválido.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    tipo_liquido = 'granel', envase, stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, tapa_ml, tapas_por_botella, precio_botella,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Nombre es requerido.' });
  }
  if (!['granel', 'marca'].includes(tipo_liquido)) {
    return res.status(400).json({ message: 'Tipo de líquido inválido.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /productos/:id/rellenar ────────────────────────────────
// Rellena N botellas desde el bidón (solo granel). Mueve N×tapas_por_botella
// de "a granel" a "rellenadas". Topa N a lo que alcance el líquido a granel.
export const rellenarBotellas = async (req, res) => {
  const { id } = req.params;
  const botellas = Number(req.body?.botellas);

  if (!Number.isInteger(botellas) || botellas <= 0) {
    return res.status(400).json({ message: 'Indica cuántas botellas rellenaste (entero > 0).' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    return res.status(400).json({ message: 'Tipo de movimiento inválido.' });
  }
  if (!['granel', 'botellas'].includes(destino)) {
    return res.status(400).json({ message: 'Destino inválido.' });
  }
  if (!['bidon', 'botella', 'tapa'].includes(unidad)) {
    return res.status(400).json({ message: 'Unidad inválida.' });
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
      return res.status(400).json({ message: 'No se puede convertir la unidad; revisa los tamaños del producto.' });
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
        return res.status(400).json({ message: 'No hay suficiente existencia para esa salida.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    return res.status(400).json({ message: 'Productos inválidos.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
