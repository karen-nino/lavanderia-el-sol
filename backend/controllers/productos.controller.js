import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';
import { esFechaISO } from '../utils/tz.js';

/** Semáforo de existencia contra el mínimo de cada producto (lo disponible). */
const ESTADO_STOCK_SQL = `
  CASE
    WHEN (stock_actual - stock_reservado) = 0
      THEN 'agotado'
    WHEN (stock_actual - stock_reservado) <= stock_minimo
      THEN 'por_agotarse'
    ELSE 'ok'
  END AS estado_stock
`.trim();

/**
 * Campos derivados para mostrar botellas y bidones:
 * - medidas_por_botella = floor(botella_ml / medida_ml)
 * - botellas_por_bidon = floor(volumen_envase_ml / botella_ml)
 */
const DERIVADOS_SQL = `
  CASE WHEN botella_ml > 0 AND medida_ml > 0
       THEN floor(botella_ml::numeric / medida_ml) END AS medidas_por_botella,
  CASE WHEN volumen_envase_ml > 0 AND botella_ml > 0
       THEN floor(volumen_envase_ml::numeric / botella_ml) END AS botellas_por_bidon
`.trim();

/** Semáforo del bidón (solo granel): agotado sin nada, por agotarse con menos de un bidón. */
const ESTADO_GRANEL_SQL = `
  CASE WHEN tipo_liquido = 'granel' THEN
    CASE
      WHEN stock_granel_medidas <= 0 THEN 'agotado'
      WHEN stock_minimo_granel > 0 AND stock_granel_medidas <= stock_minimo_granel THEN 'por_agotarse'
      ELSE 'ok'
    END
  END AS estado_granel
`.trim();

/** SELECT de un producto con sus campos calculados. */
const SELECT_PRODUCTO = `*,
              (stock_actual - stock_reservado) AS stock_disponible,
              ${DERIVADOS_SQL},
              ${ESTADO_STOCK_SQL},
              ${ESTADO_GRANEL_SQL}`;

/**
 * Tamaño de la medida en mL: el dado, o derivado de cuántas medidas rinde una
 * botella (floor(botella_ml / N)).
 */
function resolverMedidaMl(medidaMl, medidasPorBotella, botellaMl) {
  const explicito = Number(medidaMl) || 0;
  if (explicito > 0) return explicito;
  const n = Number(medidasPorBotella) || 0;
  if (n > 0 && botellaMl > 0) return Math.max(1, Math.floor(botellaMl / n));
  return 0;
}

/**
 * Unidades de existencia que vale una unidad dada:
 * - Líquidos (en medidas): medida 1, botella = medidas por botella, bidón = medidas por bidón.
 * - Bolsas (en piezas): pieza 1, rollo = bolsas por rollo.
 */
function medidasDeUnidad(unidad, p) {
  if (unidad === 'pieza') return 1;
  if (unidad === 'rollo') return Number(p.bolsas_por_rollo) || 0;
  const medidaMl    = Number(p.medida_ml) || 0;
  const botellaMl = Number(p.botella_ml) || 0;
  const bidonMl   = Number(p.volumen_envase_ml) || 0;
  if (unidad === 'medida')    return 1;
  if (unidad === 'botella') return medidaMl > 0 ? Math.floor(botellaMl / medidaMl) : 0;
  if (unidad === 'bidon')   return medidaMl > 0 ? Math.floor(bidonMl / medidaMl) : 0;
  return 0;
}

/** Inserta un movimiento en el historial de inventario. */
async function registrarMovimiento(client, {
  productoId, sucursal, usuarioId, tipo, destino, cantidadMedidas,
  descripcion = null, notaId = null, nota = null,
}) {
  await client.query(
    `INSERT INTO producto_movimientos
       (producto_id, sucursal, usuario_id, tipo, destino, cantidad_medidas, descripcion, nota_id, nota)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [productoId, sucursal, usuarioId ?? null, tipo, destino, cantidadMedidas, descripcion, notaId, nota]
  );
}

export const getProductos = async (req, res) => {
  // Solo activos; con ?archivados=1, los archivados.
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

/** Archiva o restaura un producto (admin). No borra: lo conservan sus notas. */
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

/**
 * Tamaño de bolsa tal como está en el catálogo (Ajustes → Inventario), buscado
 * sin distinguir mayúsculas; null si no existe. Incluye los inactivos para poder
 * editar el producto que ya lo usa.
 */
async function tamanoBolsaDelCatalogo(tamano) {
  const limpio = String(tamano ?? '').trim();
  if (!limpio) return null;
  const { rows } = await pool.query(
    'SELECT nombre FROM tamanos_bolsa WHERE lower(nombre) = lower($1) LIMIT 1',
    [limpio]
  );
  return rows[0]?.nombre ?? null;
}

const MSG_TAMANO_BOLSA =
  'Elige un tamaño de bolsa de la lista. Se administran en Ajustes → Inventario.';

/**
 * Servicios Por Encargo en los que la bolsa se precarga sola (vacío = ninguno).
 * Una bolsa puede cubrir varios servicios.
 */
const SERVICIOS_BOLSA = ['chico', 'mediano', 'grande', 'edredon'];
function normalizarServiciosBolsa(v) {
  if (v === undefined || v === null || v === '') return { valor: [] };
  const lista = Array.isArray(v) ? v : [v];
  const limpia = [...new Set(lista.filter(x => x !== null && x !== undefined && x !== ''))];
  if (limpia.some(x => !SERVICIOS_BOLSA.includes(x))) {
    return { error: 'Elige servicios válidos para la bolsa: chico, mediano, grande o edredón.' };
  }
  return { valor: limpia };
}

const NOMBRE_SERVICIO = { chico: 'Chico', mediano: 'Mediano', grande: 'Grande', edredon: 'Edredón' };

/**
 * Un servicio no puede tener dos bolsas activas (no se sabría cuál precargar).
 * Va aquí porque un arreglo no admite índice único.
 */
async function servicioBolsaOcupado(servicios, sucursal, excluirId) {
  if (servicios.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT servicios_bolsa FROM productos
      WHERE clase = 'bolsa' AND archivado = FALSE AND sucursal = $1
        AND servicios_bolsa && $2::TEXT[]
        AND ($3::INTEGER IS NULL OR id <> $3)`,
    [sucursal, servicios, excluirId ?? null]
  );
  if (rows.length === 0) return null;
  const chocan = servicios.filter(sv => rows.some(r => (r.servicios_bolsa ?? []).includes(sv)));
  const txt = chocan.map(sv => NOMBRE_SERVICIO[sv] ?? sv).join(' y ');
  return `Ya hay otra bolsa ligada a ${txt}. Quítasela a esa primero.`;
}

/** Bolsas por rollo; vacío = se surte por pieza. */
function normalizarBolsasPorRollo(v) {
  if (v === undefined || v === null || v === '') return { valor: null };
  const n = Number(v);
  if (!(n > 0)) return { error: 'Indica cuántas bolsas trae un rollo.' };
  return { valor: Math.round(n) };
}

/** Crea una bolsa contada en piezas. Nace en 0; la existencia entra con una Entrada. */
async function crearBolsa(req, res, { nombre, descripcion, marca, tamano_bolsa, bolsas_por_rollo, servicios_bolsa, precio_unitario, stock_minimo }) {
  const tamano = await tamanoBolsaDelCatalogo(tamano_bolsa);
  if (!tamano) {
    return res.status(400).json({ message: MSG_TAMANO_BOLSA });
  }
  const rollo = normalizarBolsasPorRollo(bolsas_por_rollo);
  if (rollo.error) {
    return res.status(400).json({ message: rollo.error });
  }
  const servicios = normalizarServiciosBolsa(servicios_bolsa);
  if (servicios.error) {
    return res.status(400).json({ message: servicios.error });
  }
  const ocupado = await servicioBolsaOcupado(servicios.valor, req.sucursal);
  if (ocupado) {
    return res.status(400).json({ message: ocupado });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO productos
         (nombre, descripcion, unidad, precio_unitario, stock_actual, marca, sucursal,
          clase, tamano_bolsa, bolsas_por_rollo, servicios_bolsa, es_por_medida, stock_minimo)
       VALUES ($1, $2, 'pieza', $3, 0, $4, $5, 'bolsa', $6, $7, $8, false, $9)
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, precio_unitario ?? null, marca || null, req.sucursal,
       tamano, rollo.valor, servicios.valor, Number(stock_minimo) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('crearBolsa error:', err);
    res.status(500).json({ message: 'No se pudieron guardar las bolsas. Intenta de nuevo.' });
  }
}

export const createProducto = async (req, res) => {
  const {
    nombre, descripcion, unidad = 'Medidas', precio_unitario, marca,
    clase = 'liquido', tipo_liquido = 'granel', forma = 'liquido', envase,
    stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, medida_ml, medidas_por_botella, precio_botella,
    // Granel líquido: su tipo (Jabón, Suavizante…).
    tipo_granel_id,
    // Bolsas:
    tamano_bolsa, bolsas_por_rollo, servicios_bolsa,
    // Existencias iniciales: botellas rellenadas y (granel) bidones a granel.
    stock_botellas = 0, stock_bidones = 0,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Escribe el nombre del producto.' });
  }

  // ── Bolsa: producto simple contado en piezas, comprado por rollo ──
  if (clase === 'bolsa') {
    return crearBolsa(req, res, {
      nombre, descripcion, marca, tamano_bolsa, bolsas_por_rollo, servicios_bolsa,
      precio_unitario, stock_minimo,
    });
  }

  if (!['granel', 'marca'].includes(tipo_liquido)) {
    return res.status(400).json({ message: 'Indica si el producto es a granel o de marca.' });
  }
  if (!['liquido', 'polvo'].includes(forma)) {
    return res.status(400).json({ message: 'Indica si el producto es líquido o en polvo.' });
  }
  // El polvo se cuenta por unidades enteras, como la marca (1 unidad = 1 medida).
  const esPolvo = forma === 'polvo';
  const botellaMl = esPolvo ? 1 : Number(botella_ml);
  if (!(botellaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la botella (mL).' });
  }
  // La medida llega en mL o como medidas por botella.
  const medidaMl = esPolvo ? 1 : resolverMedidaMl(medida_ml, medidas_por_botella, botellaMl);
  if (!(medidaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la medida (mL) o cuántas medidas salen de una botella.' });
  }
  const conBidon = tipo_liquido === 'granel' && !esPolvo;
  if (conBidon && (!volumen_envase_ml || Number(volumen_envase_ml) <= 0)) {
    return res.status(400).json({ message: 'Indica el volumen del bidón (mL).' });
  }
  // Solo el granel líquido lleva tipo; vacío = sin tipo.
  const tipoGranel = conBidon && tipo_granel_id !== undefined && tipo_granel_id !== null && tipo_granel_id !== ''
    ? Number(tipo_granel_id) : null;
  if (tipoGranel !== null && !(Number.isInteger(tipoGranel) && tipoGranel > 0)) {
    return res.status(400).json({ message: 'Elige un tipo de granel de la lista.' });
  }

  const bidonMl   = conBidon ? Number(volumen_envase_ml) : null;
  const medidasPorBotella = Math.floor(botellaMl / medidaMl);
  const medidasPorBidon   = bidonMl ? Math.floor(bidonMl / medidaMl) : 0;
  const medidasPorEnvase  = conBidon ? medidasPorBidon : medidasPorBotella;

  // Existencia en medidas: rellenadas (stock_actual) y a granel (bidón).
  const stockActual = Math.round((Number(stock_botellas) || 0) * medidasPorBotella);
  const stockGranel = Math.round((Number(stock_bidones)  || 0) * medidasPorBidon);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO productos
         (nombre, descripcion, unidad, precio_unitario, precio_botella, stock_actual,
          stock_granel_medidas, marca, sucursal, tipo_liquido, forma, es_por_medida, medidas_por_envase,
          envase, stock_minimo, stock_minimo_granel, volumen_envase_ml, botella_ml, medida_ml,
          tipo_granel_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, precio_botella ?? null,
       stockActual, stockGranel, marca || null, req.sucursal, tipo_liquido, forma, medidasPorEnvase,
       envase || null, Number(stock_minimo) || 0,
       conBidon ? (Number(stock_minimo_granel) || 0) : 0,
       bidonMl, botellaMl, medidaMl, tipoGranel]
    );
    const prod = rows[0];
    // Las existencias iniciales quedan como entradas en el historial.
    if (stockGranel > 0) {
      await registrarMovimiento(client, {
        productoId: prod.id, sucursal: req.sucursal, usuarioId: req.user?.id,
        tipo: 'entrada', destino: 'granel', cantidadMedidas: stockGranel,
        descripcion: `${Number(stock_bidones)} bidón(es) inicial(es)`,
      });
    }
    if (stockActual > 0) {
      await registrarMovimiento(client, {
        productoId: prod.id, sucursal: req.sucursal, usuarioId: req.user?.id,
        tipo: 'entrada', destino: 'botellas', cantidadMedidas: stockActual,
        descripcion: `${Number(stock_botellas)} botella(s) inicial(es)`,
      });
    }
    await client.query('COMMIT');
    res.status(201).json(prod);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Elige un tipo de granel de la lista.' });
    }
    console.error('createProducto error:', err);
    res.status(500).json({ message: 'No se pudo crear el producto. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

/**
 * Edita los atributos del producto (admin). La existencia no se toca aquí: se
 * mueve con Entrada, Salida y Rellenar, que quedan en el historial.
 */
export const updateProducto = async (req, res) => {
  const { id } = req.params;
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede editar el producto.' });
  }

  const {
    nombre, descripcion, unidad = 'Medidas', precio_unitario, marca,
    clase = 'liquido', tipo_liquido = 'granel', forma = 'liquido', envase,
    stock_minimo = 0, stock_minimo_granel = 0,
    volumen_envase_ml, botella_ml, medida_ml, medidas_por_botella, precio_botella,
    tamano_bolsa, bolsas_por_rollo, servicios_bolsa, tipo_granel_id,
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'Escribe el nombre del producto.' });
  }

  // ── Bolsa: solo atributos (tamaño, bolsas por rollo, precio por pieza) ──
  if (clase === 'bolsa') {
    const tamano = await tamanoBolsaDelCatalogo(tamano_bolsa);
    if (!tamano) {
      return res.status(400).json({ message: MSG_TAMANO_BOLSA });
    }
    const rollo = normalizarBolsasPorRollo(bolsas_por_rollo);
    if (rollo.error) {
      return res.status(400).json({ message: rollo.error });
    }
    const servicios = normalizarServiciosBolsa(servicios_bolsa);
    if (servicios.error) {
      return res.status(400).json({ message: servicios.error });
    }
    const ocupado = await servicioBolsaOcupado(servicios.valor, req.sucursal, id);
    if (ocupado) {
      return res.status(400).json({ message: ocupado });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE productos
           SET nombre = $1, descripcion = $2, precio_unitario = $3, marca = $4,
               tamano_bolsa = $5, bolsas_por_rollo = $6, servicios_bolsa = $7,
               stock_minimo = $8, updated_at = NOW()
         WHERE id = $9 AND sucursal = $10
         RETURNING ${SELECT_PRODUCTO}`,
        [nombre, descripcion || null, precio_unitario ?? null, marca || null,
         tamano, rollo.valor, servicios.valor, Number(stock_minimo) || 0, id, req.sucursal]
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
  if (!['liquido', 'polvo'].includes(forma)) {
    return res.status(400).json({ message: 'Indica si el producto es líquido o en polvo.' });
  }
  // El polvo se cuenta por unidades enteras, como la marca (1 unidad = 1 medida).
  const esPolvo = forma === 'polvo';
  const botellaMl = esPolvo ? 1 : Number(botella_ml);
  if (!(botellaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la botella (mL).' });
  }
  const medidaMl = esPolvo ? 1 : resolverMedidaMl(medida_ml, medidas_por_botella, botellaMl);
  if (!(medidaMl > 0)) {
    return res.status(400).json({ message: 'Indica el tamaño de la medida (mL) o cuántas medidas salen de una botella.' });
  }
  const conBidon = tipo_liquido === 'granel' && !esPolvo;
  if (conBidon && (!volumen_envase_ml || Number(volumen_envase_ml) <= 0)) {
    return res.status(400).json({ message: 'Indica el volumen del bidón (mL).' });
  }
  // Solo el granel líquido lleva tipo; vacío = sin tipo.
  const tipoGranel = conBidon && tipo_granel_id !== undefined && tipo_granel_id !== null && tipo_granel_id !== ''
    ? Number(tipo_granel_id) : null;
  if (tipoGranel !== null && !(Number.isInteger(tipoGranel) && tipoGranel > 0)) {
    return res.status(400).json({ message: 'Elige un tipo de granel de la lista.' });
  }


  const bidonMl   = conBidon ? Number(volumen_envase_ml) : null;
  const medidasPorEnvase = conBidon
    ? Math.floor(bidonMl / medidaMl)
    : Math.floor(botellaMl / medidaMl);

  // Con existencia o algo apartado, los tamaños no se tocan: la existencia está
  // en medidas y cambiaría de significado.
  const { rows: actualRows } = await pool.query(
    `SELECT tipo_liquido, COALESCE(forma, 'liquido') AS forma, botella_ml, medida_ml,
            volumen_envase_ml, stock_actual, stock_granel_medidas, stock_reservado
       FROM productos WHERE id = $1 AND sucursal = $2`,
    [id, req.sucursal]
  );
  const actual = actualRows[0];
  if (actual) {
    const distinto = (a, b) => (a == null ? null : Number(a)) !== (b == null ? null : Number(b));
    const cambiaTamano = actual.tipo_liquido !== tipo_liquido
      || actual.forma !== forma
      || distinto(actual.botella_ml, botellaMl)
      || distinto(actual.medida_ml, medidaMl)
      || (conBidon && distinto(actual.volumen_envase_ml, bidonMl));
    const conExistencia = Number(actual.stock_actual) > 0
      || Number(actual.stock_granel_medidas) > 0
      || Number(actual.stock_reservado) > 0;
    if (cambiaTamano && conExistencia) {
      return res.status(409).json({
        message: Number(actual.stock_reservado) > 0
          ? 'No se pueden cambiar los tamaños ni el tipo: este producto está apartado en notas abiertas. '
            + 'Espera a que se cierren o quítalo de ellas.'
          : 'No se pueden cambiar los tamaños ni el tipo con existencia: la existencia se calcula con '
            + 'ellos y se descuadraría. Registra una salida de todo, corrige el producto y vuelve a dar entrada.',
      });
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE productos
         SET nombre = $1, descripcion = $2, unidad = $3, precio_unitario = $4,
             precio_botella = $5, marca = $6, tipo_liquido = $7, forma = $8,
             medidas_por_envase = $9, envase = $10, stock_minimo = $11,
             stock_minimo_granel = $12, volumen_envase_ml = $13,
             botella_ml = $14, medida_ml = $15, es_por_medida = true,
             tipo_granel_id = $16, updated_at = NOW()
       WHERE id = $17 AND sucursal = $18
       RETURNING ${SELECT_PRODUCTO}`,
      [nombre, descripcion || null, unidad, precio_unitario ?? null, precio_botella ?? null,
       marca || null, tipo_liquido, forma, medidasPorEnvase, envase || null, Number(stock_minimo) || 0,
       conBidon ? (Number(stock_minimo_granel) || 0) : 0,
       bidonMl, botellaMl, medidaMl, tipoGranel, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Elige un tipo de granel de la lista.' });
    }
    console.error('updateProducto error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios del producto. Intenta de nuevo.' });
  }
};

// ── POST /productos/:id/rellenar ────────────────────────────────
/**
 * Rellena N botellas desde el bidón (solo granel): pasa N × medidas por botella
 * de "a granel" a "rellenadas", hasta lo que alcance.
 */
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
    if (p.tipo_liquido !== 'granel' || p.forma === 'polvo') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo los productos líquidos a granel se rellenan desde un bidón.' });
    }
    const medidasPorBotella = medidasDeUnidad('botella', p);
    if (medidasPorBotella <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El producto no tiene bien definidos los tamaños de botella y medida.' });
    }
    const maxBotellas = Math.floor(Number(p.stock_granel_medidas) / medidasPorBotella);
    if (botellas > maxBotellas) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Solo alcanza para ${maxBotellas} botella(s) con el líquido a granel disponible.` });
    }
    const medidas = botellas * medidasPorBotella;
    const { rows: upd } = await client.query(
      `UPDATE productos
         SET stock_granel_medidas = stock_granel_medidas - $1,
             stock_actual = stock_actual + $1,
             updated_at = NOW()
       WHERE id = $2 AND sucursal = $3
       RETURNING ${SELECT_PRODUCTO}`,
      [medidas, id, req.sucursal]
    );
    await registrarMovimiento(client, {
      productoId: p.id, sucursal: req.sucursal, usuarioId: req.user?.id,
      tipo: 'rellenar', destino: 'botellas', cantidadMedidas: medidas,
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
/**
 * Entrada o salida manual. destino: 'granel' | 'botellas'; unidad: 'bidon' |
 * 'botella' | 'medida' | 'pieza' | 'rollo' (se convierte a medidas o piezas).
 */
export const crearMovimiento = async (req, res) => {
  const { id } = req.params;
  const { tipo, destino, cantidad, unidad } = req.body;

  if (!['entrada', 'salida'].includes(tipo)) {
    return res.status(400).json({ message: 'El movimiento debe ser una entrada o una salida.' });
  }
  // Motivo libre de una salida manual (opcional).
  const nota = tipo === 'salida' ? (String(req.body.nota ?? '').trim().slice(0, 1000) || null) : null;
  if (!['granel', 'botellas', 'piezas'].includes(destino)) {
    return res.status(400).json({ message: 'Indica a dónde va el movimiento: granel, botellas o piezas.' });
  }
  if (!['bidon', 'botella', 'medida', 'rollo', 'pieza'].includes(unidad)) {
    return res.status(400).json({ message: 'Elige una unidad válida: bidón, botella, medida, rollo o pieza.' });
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
    if (destino === 'granel' && (p.tipo_liquido !== 'granel' || p.forma === 'polvo')) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Este producto no maneja existencia a granel.' });
    }
    if (unidad === 'rollo' && !(Number(p.bolsas_por_rollo) > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Estas bolsas se compran por pieza, no por rollo. Registra el movimiento en piezas.' });
    }
    const medidasPorUnidad = medidasDeUnidad(unidad, p);
    if (medidasPorUnidad <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Faltan datos del producto (tamaños o bolsas por rollo) para registrar el movimiento. Revísalos en su edición.' });
    }
    const medidas = Math.round(cant * medidasPorUnidad);
    const columna = destino === 'granel' ? 'stock_granel_medidas' : 'stock_actual';
    const delta = tipo === 'entrada' ? medidas : -medidas;

    // Una salida no deja existencia negativa ni toca lo apartado por notas.
    if (tipo === 'salida') {
      const disponible = destino === 'granel'
        ? Number(p.stock_granel_medidas)
        : Number(p.stock_actual) - Number(p.stock_reservado);
      if (medidas > disponible) {
        await client.query('ROLLBACK');
        // Lo disponible en la unidad elegida.
        const dispUnidad = Math.floor(disponible / medidasPorUnidad);
        const uni = unidad === 'bidon' ? 'bidón(es)' : unidad === 'rollo' ? 'rollo(s)'
          : unidad === 'pieza' ? 'bolsa(s)' : unidad === 'botella' ? 'botella(s)' : 'medida(s)';
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
            : 'medida(s)';
    await registrarMovimiento(client, {
      productoId: p.id, sucursal: req.sucursal, usuarioId: req.user?.id,
      tipo, destino, cantidadMedidas: medidas,
      descripcion: `${cant} ${unidadTxt}`,
      nota,
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
/**
 * ¿Esta venta (alias `m`) se devolvió después? Se empata por nota (viva o
 * borrada, por su folio) y producto. Una venta devuelta solo cuenta en Devuelto.
 */
const VENTA_DEVUELTA_SQL = `EXISTS (
  SELECT 1 FROM producto_movimientos l
   WHERE l.tipo = 'liberacion'
     AND l.producto_id = m.producto_id
     AND l.sucursal    = m.sucursal
     AND l.created_at >= m.created_at
     AND ((m.nota_id    IS NOT NULL AND l.nota_id    = m.nota_id)
       OR (m.nota_folio IS NOT NULL AND l.nota_folio = m.nota_folio)))`;

/** Servicios que cuentan como SPE (Por Encargo) en las Ventas del Reporte diario. */
const SERVICIOS_SPE_SQL = `('POR_ENCARGO', 'EDREDON')`;

/**
 * Tipos de movimiento por filtro del Reporte diario. Rellenar va en entradas y
 * salidas: no entra ni sale, pero explica el cambio de cada existencia.
 */
/**
 * Renglones de productos en notas no canceladas de la sucursal ($1), con
 * cuándo salieron de verdad del estante. `consumido_at` NULL = sigue apartado.
 * Si no, el primer movimiento 'venta' de esa nota y producto; sin venta (notas
 * de antes del historial, que la mig. 161 fechó el día de la migración), el día
 * en que se puso. Necesita la CTE `bounds` (inicio y cierre del día).
 */
const RENGLONES_NOTA_SQL = `
  SELECT np.id, np.producto_id, np.nota_id, np.cantidad_medidas, np.created_at, n.folio, n.usuario_id,
         CASE WHEN np.consumido_at IS NOT NULL THEN
           LEAST(np.consumido_at,
                 COALESCE((SELECT MIN(v.created_at) FROM producto_movimientos v
                            WHERE v.tipo = 'venta' AND v.nota_id = np.nota_id
                              AND v.producto_id = np.producto_id), np.created_at))
         END AS consumido_at
    FROM nota_productos np
    JOIN notas n ON n.id = np.nota_id
   WHERE n.sucursal = $1 AND n.estado <> 'CANCELADA'
     -- Solo los que pueden contar ese día: puestos antes del cierre y sin
     -- descontar antes del inicio (los demás ya no cambian nada).
     AND np.created_at < (SELECT cierre FROM bounds)
     AND (np.consumido_at IS NULL OR np.consumido_at >= (SELECT inicio FROM bounds))`;

/**
 * La venta de un renglón que se apartó un día ANTERIOR: ya contó como salida
 * ese día (al apartarse), así que no vuelve a contar al descontarse. Se empata
 * con su renglón por nota, producto y cantidad (otro renglón del mismo producto
 * puesto hoy sí cuenta). Usa `m` (el movimiento), `renglones` y `bounds`.
 */
const VENTA_YA_APARTADA_SQL = `EXISTS (
  SELECT 1 FROM renglones r
   WHERE r.nota_id = m.nota_id AND r.producto_id = m.producto_id
     AND r.cantidad_medidas = m.cantidad_medidas
     AND r.created_at < bounds.inicio AND r.consumido_at >= bounds.inicio)`;

const TIPOS_MOVIMIENTO = {
  entradas: ['entrada', 'rellenar'],
  salidas:  ['venta', 'salida', 'rellenar'],
  devueltos: ['liberacion'],
};

/**
 * Historial de un producto, del más reciente al más viejo. Filtros opcionales:
 * `fecha` (día local) y `tipo` (entradas | salidas | devueltos).
 */
export const getMovimientos = async (req, res) => {
  const { id } = req.params;
  const fecha = esFechaISO(req.query.fecha) ? req.query.fecha : null;
  const tipos = TIPOS_MOVIMIENTO[req.query.tipo] ?? null;
  try {
    // Ventas de un día (columna Ventas del Reporte diario): lo puesto ese día en
    // notas no canceladas, con la forma de un movimiento 'venta'.
    if (['ventas', 'ventas_auto', 'ventas_spe'].includes(req.query.tipo)) {
      // Sin día no hay ventas que listar (no se cae al historial completo).
      if (!fecha) return res.json([]);
      // ventas_spe: solo Por Encargo; ventas_auto: lo demás (Autoservicio y mostrador).
      const servicio = req.query.tipo === 'ventas_spe' ? `AND n.tipo_servicio IN ${SERVICIOS_SPE_SQL}`
        : req.query.tipo === 'ventas_auto' ? `AND n.tipo_servicio NOT IN ${SERVICIOS_SPE_SQL}` : '';
      const { rows: ventas } = await pool.query(
        `SELECT 'v' || np.id AS id, np.producto_id, n.usuario_id, 'venta' AS tipo,
                'botellas' AS destino, np.cantidad_medidas, np.nota_id, np.created_at,
                TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
                n.folio AS nota_folio
           FROM nota_productos np
           JOIN notas n ON n.id = np.nota_id
           LEFT JOIN usuarios u ON u.id = n.usuario_id
          WHERE np.producto_id = $1 AND n.sucursal = $2 AND n.estado <> 'CANCELADA' ${servicio}
            AND np.created_at >= ($3::date)::timestamp     AT TIME ZONE 'America/Mexico_City'
            AND np.created_at <  ($3::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City'
          ORDER BY np.created_at DESC, np.id DESC`,
        [id, req.sucursal, fecha]
      );
      return res.json(ventas);
    }
    const { rows } = await pool.query(
      `WITH bounds AS (
         SELECT ($3::date)::timestamp     AT TIME ZONE 'America/Mexico_City' AS inicio,
                ($3::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City' AS cierre
       ),
       renglones AS (${RENGLONES_NOTA_SQL.replace('$1', '$2')})
       SELECT m.id, m.producto_id, m.sucursal, m.usuario_id, m.tipo, m.destino,
              m.cantidad_medidas, m.descripcion, m.nota_id, m.nota, m.created_at,
              TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
              -- El folio vivo o, si la nota se borró, el copiado.
              COALESCE(n.folio, m.nota_folio) AS nota_folio
         FROM producto_movimientos m
         CROSS JOIN bounds
         LEFT JOIN usuarios u ON u.id = m.usuario_id
         LEFT JOIN notas n    ON n.id = m.nota_id
        WHERE m.producto_id = $1 AND m.sucursal = $2
          AND ($3::date IS NULL OR (
                m.created_at >= ($3::date)::timestamp     AT TIME ZONE 'America/Mexico_City'
            AND m.created_at <  ($3::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City'))
          AND ($4::text[] IS NULL OR m.tipo = ANY($4))
          -- En Salidas no aparece la venta devuelta (va en Devuelto).
          AND NOT ($5 AND m.tipo = 'venta' AND ${VENTA_DEVUELTA_SQL})
          -- Ni la de un apartado de otro día (ya salió ese día).
          AND NOT ($5 AND $3::date IS NOT NULL AND m.tipo = 'venta' AND ${VENTA_YA_APARTADA_SQL})
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 200`,
      [id, req.sucursal, fecha, tipos, req.query.tipo === 'salidas']
    );
    // Salidas de un día: también lo apartado ese día que al cierre seguía sin descontarse.
    if (req.query.tipo === 'salidas' && fecha) {
      const { rows: apartados } = await pool.query(
        `WITH bounds AS (
           SELECT ($3::date)::timestamp     AT TIME ZONE 'America/Mexico_City' AS inicio,
                  ($3::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City' AS cierre
         ),
         renglones AS (${RENGLONES_NOTA_SQL})
         SELECT 'a' || r.id AS id, r.producto_id, r.usuario_id, 'apartado' AS tipo,
                'botellas' AS destino, r.cantidad_medidas, r.nota_id, r.created_at,
                TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario_nombre,
                r.folio AS nota_folio
           FROM renglones r CROSS JOIN bounds
           LEFT JOIN usuarios u ON u.id = r.usuario_id
          WHERE r.producto_id = $2
            AND r.created_at >= bounds.inicio AND r.created_at < bounds.cierre
            AND (r.consumido_at IS NULL OR r.consumido_at >= bounds.cierre)`,
        [req.sucursal, id, fecha]
      );
      rows.push(...apartados);
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    res.json(rows);
  } catch (err) {
    console.error('getMovimientos error:', err);
    res.status(500).json({ message: 'No se pudo cargar el historial del producto. Intenta de nuevo.' });
  }
};

// ── GET /productos/:id/apartados ────────────────────────────────
/**
 * Notas abiertas que tienen apartado este producto (renglones sin descontar):
 * folio, cliente, cuánto y desde cuándo. Es lo que suma su stock_reservado.
 */
export const getApartados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT np.id, np.nota_id, n.folio, n.tipo_servicio, n.estado, np.created_at,
              np.cantidad, np.unidad, np.cantidad_medidas,
              TRIM(COALESCE(c.nombre, '') || ' ' || COALESCE(c.apellido, '')) AS cliente,
              n.referencia
         FROM nota_productos np
         JOIN notas n ON n.id = np.nota_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
        WHERE np.producto_id = $1 AND n.sucursal = $2
          AND np.consumido_at IS NULL AND n.estado <> 'CANCELADA'
        ORDER BY np.created_at ASC, np.id ASC`,
      [req.params.id, req.sucursal]
    );
    res.json(rows.map((r) => ({ ...r, cliente: r.cliente || null })));
  } catch (err) {
    console.error('getApartados error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las notas con este producto apartado. Intenta de nuevo.' });
  }
};

// ── GET /productos/reporte-diario?fecha=YYYY-MM-DD ──────────────
/**
 * Reporte del día por producto, bolsas incluidas (cualquier rol): qué había al
 * inicio, qué entró, salió, se devolvió y qué quedó al cierre. La existencia de
 * un día se reconstruye desde la actual deshaciendo los movimientos posteriores:
 * - entrada / salida: + / − en su destino (botellas o piezas, o bidón);
 * - rellenar: + botellas y − bidón;
 * - venta: − botellas (o piezas); liberacion (venta anulada): + botellas.
 * Lo apartado en notas cuenta como salida el día que se apartó (y su venta,
 * al descontarse otro día, ya no) y no entra en Había ni en Queda.
 * El día es el local (America/Mexico_City).
 */
export const getReporteDiario = async (req, res) => {
  const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  // esFechaISO valida también que el día exista.
  const fecha = esFechaISO(req.query.fecha) ? req.query.fecha : hoyMx;

  try {
    const { rows } = await pool.query(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp        AT TIME ZONE 'America/Mexico_City' AS inicio,
                (($2::date + 1))::timestamp   AT TIME ZONE 'America/Mexico_City' AS cierre
       ),
       renglones AS (${RENGLONES_NOTA_SQL})
       SELECT
         p.id, p.nombre, p.marca, p.tipo_liquido, p.forma, p.se_vende_por_unidad,
         p.clase, p.tamano_bolsa,
         CASE WHEN p.botella_ml > 0 AND p.medida_ml > 0
              THEN floor(p.botella_ml::numeric / p.medida_ml) END        AS medidas_por_botella,
         CASE WHEN p.volumen_envase_ml > 0 AND p.medida_ml > 0
              THEN floor(p.volumen_envase_ml::numeric / p.medida_ml) END AS medidas_por_bidon,
         p.stock_actual,
         p.stock_granel_medidas,
         -- Salió por notas: vendido menos devuelto. Puede ser negativo si hoy se
         -- devolvió algo vendido otro día.
         COALESCE((
           SELECT SUM(CASE WHEN m.tipo = 'venta' THEN m.cantidad_medidas
                           ELSE -m.cantidad_medidas END)
             FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo IN ('venta', 'liberacion')
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS vendido_medidas,
         -- Entradas del día (incluida la existencia inicial), por destino.
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'entrada' AND m.destino IN ('botellas', 'piezas')
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS entrada_botellas_medidas,
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'entrada' AND m.destino = 'granel'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS entrada_granel_medidas,
         -- Salidas manuales del día (merma, dañado…), por destino.
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'salida' AND m.destino IN ('botellas', 'piezas')
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS salida_botellas_medidas,
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'salida' AND m.destino = 'granel'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS salida_granel_medidas,
         -- Rellenado del día (bidón → botellas).
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'rellenar'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS rellenado_medidas,
         -- Vendido ese día y no devuelto después (lo que cuenta en Salidas).
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'venta'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
              AND NOT ${VENTA_DEVUELTA_SQL}
              AND NOT ${VENTA_YA_APARTADA_SQL}
         ), 0) AS vendido_vigente_medidas,
         -- Apartado ese día en notas y aún sin descontar al cierre: ya salió (tiene dueño).
         COALESCE((
           SELECT SUM(r.cantidad_medidas) FROM renglones r, bounds
            WHERE r.producto_id = p.id
              AND r.created_at >= bounds.inicio AND r.created_at < bounds.cierre
              AND (r.consumido_at IS NULL OR r.consumido_at >= bounds.cierre)
         ), 0) AS apartado_medidas,
         -- Lo apartado sin descontar al inicio y al cierre del día (no está en el estante libre).
         COALESCE((
           SELECT SUM(r.cantidad_medidas) FROM renglones r, bounds
            WHERE r.producto_id = p.id AND r.created_at < bounds.inicio
              AND (r.consumido_at IS NULL OR r.consumido_at >= bounds.inicio)
         ), 0) AS apartado_inicio_medidas,
         COALESCE((
           SELECT SUM(r.cantidad_medidas) FROM renglones r, bounds
            WHERE r.producto_id = p.id AND r.created_at < bounds.cierre
              AND (r.consumido_at IS NULL OR r.consumido_at >= bounds.cierre)
         ), 0) AS apartado_fin_medidas,
         -- Ventas: lo puesto ese día en notas no canceladas, en medidas y en dinero
         -- (al precio del renglón).
         COALESCE((
           SELECT SUM(np.cantidad_medidas)
             FROM nota_productos np JOIN notas n ON n.id = np.nota_id, bounds
            WHERE np.producto_id = p.id AND n.sucursal = $1 AND n.estado <> 'CANCELADA'
              AND np.created_at >= bounds.inicio AND np.created_at < bounds.cierre
         ), 0) AS ventas_medidas,
         -- Las mismas, de notas Por Encargo (SPE); lo demás es Autoservicio y mostrador.
         COALESCE((
           SELECT SUM(np.cantidad_medidas)
             FROM nota_productos np JOIN notas n ON n.id = np.nota_id, bounds
            WHERE np.producto_id = p.id AND n.sucursal = $1 AND n.estado <> 'CANCELADA'
              AND n.tipo_servicio IN ${SERVICIOS_SPE_SQL}
              AND np.created_at >= bounds.inicio AND np.created_at < bounds.cierre
         ), 0) AS ventas_spe_medidas,
         COALESCE((
           SELECT SUM(np.cantidad * np.precio_unitario)
             FROM nota_productos np JOIN notas n ON n.id = np.nota_id, bounds
            WHERE np.producto_id = p.id AND n.sucursal = $1 AND n.estado <> 'CANCELADA'
              AND np.created_at >= bounds.inicio AND np.created_at < bounds.cierre
         ), 0) AS ventas_importe,
         -- Devuelto ese día (ventas anuladas).
         COALESCE((
           SELECT SUM(m.cantidad_medidas) FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.tipo = 'liberacion'
              AND m.created_at >= bounds.inicio AND m.created_at < bounds.cierre
         ), 0) AS devuelto_medidas,
         -- Lo mismo desde el inicio del día ("Había al inicio").
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada'    AND m.destino IN ('botellas', 'piezas') THEN  m.cantidad_medidas
             WHEN m.tipo = 'salida'     AND m.destino IN ('botellas', 'piezas') THEN -m.cantidad_medidas
             WHEN m.tipo = 'rellenar'                              THEN  m.cantidad_medidas
             WHEN m.tipo = 'venta'      AND m.destino IN ('botellas', 'piezas') THEN -m.cantidad_medidas
             WHEN m.tipo = 'liberacion' AND m.destino IN ('botellas', 'piezas') THEN  m.cantidad_medidas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.inicio
         ), 0) AS efecto_botellas_desde_inicio,
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada' AND m.destino = 'granel' THEN  m.cantidad_medidas
             WHEN m.tipo = 'salida'  AND m.destino = 'granel' THEN -m.cantidad_medidas
             WHEN m.tipo = 'rellenar'                         THEN -m.cantidad_medidas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.inicio
         ), 0) AS efecto_granel_desde_inicio,
         -- Efecto sobre botellas de lo ocurrido DESPUÉS del cierre (para revertir).
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada'    AND m.destino IN ('botellas', 'piezas') THEN  m.cantidad_medidas
             WHEN m.tipo = 'salida'     AND m.destino IN ('botellas', 'piezas') THEN -m.cantidad_medidas
             WHEN m.tipo = 'rellenar'                              THEN  m.cantidad_medidas
             WHEN m.tipo = 'venta'      AND m.destino IN ('botellas', 'piezas') THEN -m.cantidad_medidas
             WHEN m.tipo = 'liberacion' AND m.destino IN ('botellas', 'piezas') THEN  m.cantidad_medidas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.cierre
         ), 0) AS efecto_botellas_post,
         -- Efecto sobre el bidón (granel) posterior al cierre.
         COALESCE((
           SELECT SUM(CASE
             WHEN m.tipo = 'entrada' AND m.destino = 'granel' THEN  m.cantidad_medidas
             WHEN m.tipo = 'salida'  AND m.destino = 'granel' THEN -m.cantidad_medidas
             WHEN m.tipo = 'rellenar'                         THEN -m.cantidad_medidas
             ELSE 0 END)
            FROM producto_movimientos m, bounds
            WHERE m.producto_id = p.id AND m.created_at >= bounds.cierre
         ), 0) AS efecto_granel_post
       FROM productos p
       WHERE p.sucursal = $1 AND p.archivado = false
         AND (p.tipo_liquido IN ('granel', 'marca') OR p.clase = 'bolsa')
       ORDER BY (CASE WHEN p.clase = 'bolsa' THEN 2 WHEN p.tipo_liquido = 'granel' THEN 0 ELSE 1 END),
                p.marca NULLS LAST, p.tamano_bolsa NULLS LAST, p.nombre ASC`,
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
        forma:             r.forma,
        clase:             r.clase,
        tamano_bolsa:      r.tamano_bolsa,
        // La bolsa se cuenta en piezas: una "botella" por pieza.
        se_vende_por_unidad: r.clase === 'bolsa' ? true : r.se_vende_por_unidad,
        medidas_por_botella: r.clase === 'bolsa' ? 1
          : r.medidas_por_botella != null ? int(r.medidas_por_botella) : null,
        medidas_por_bidon:   r.medidas_por_bidon != null ? int(r.medidas_por_bidon) : null,
        vendido_medidas:     int(r.vendido_medidas),
        devuelto_medidas:    int(r.devuelto_medidas),
        vendido_vigente_medidas: int(r.vendido_vigente_medidas),
        apartado_medidas:        int(r.apartado_medidas),
        ventas_medidas:          int(r.ventas_medidas),
        ventas_spe_medidas:      int(r.ventas_spe_medidas),
        ventas_auto_medidas:     int(r.ventas_medidas) - int(r.ventas_spe_medidas),
        ventas_importe:          Number(r.ventas_importe) || 0,
        entrada_botellas_medidas: int(r.entrada_botellas_medidas),
        entrada_granel_medidas:   int(r.entrada_granel_medidas),
        salida_botellas_medidas:  int(r.salida_botellas_medidas),
        salida_granel_medidas:    int(r.salida_granel_medidas),
        rellenado_medidas:        int(r.rellenado_medidas),
        // Nunca negativa.
        // Sin lo apartado: eso ya salió, aunque siga en el estante.
        inicio_botellas_medidas: Math.max(0, int(r.stock_actual) - int(r.efecto_botellas_desde_inicio) - int(r.apartado_inicio_medidas)),
        inicio_granel_medidas:   Math.max(0, int(r.stock_granel_medidas) - int(r.efecto_granel_desde_inicio)),
        fin_botellas_medidas: Math.max(0, int(r.stock_actual) - int(r.efecto_botellas_post) - int(r.apartado_fin_medidas)),
        fin_granel_medidas:   Math.max(0, int(r.stock_granel_medidas) - int(r.efecto_granel_post)),
      })),
    });
  } catch (err) {
    console.error('getReporteDiario error:', err);
    res.status(500).json({ message: 'No se pudo generar el reporte del día. Intenta de nuevo.' });
  }
};

/** ¿El producto (alias `p`) tiene historia? Usado en notas o con movimientos. */
const CON_HISTORIA = (p) => `(
  EXISTS (SELECT 1 FROM nota_productos np WHERE np.producto_id = ${p}.id)
  OR EXISTS (SELECT 1 FROM producto_movimientos pm WHERE pm.producto_id = ${p}.id)
)`;

/**
 * Borrado múltiple (admin), en la sucursal. `confirmar: false` solo verifica y
 * devuelve los bloqueados (con historia) y los eliminables; `confirmar: true`
 * borra los eliminables en una transacción.
 */
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

    // Los que tienen historia no se borran.
    let bloqueadosSet = new Set();
    if (idsValidos.length > 0) {
      const { rows } = await client.query(
        `SELECT p.id FROM productos p WHERE p.id = ANY($1) AND ${CON_HISTORIA('p')}`,
        [idsValidos]
      );
      bloqueadosSet = new Set(rows.map((r) => r.id));
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
    // Con historia (notas o movimientos) no se borra: se archiva. Solo se borra
    // uno recién creado por error.
    const { rows: [h] } = await pool.query(
      `SELECT ${CON_HISTORIA('p')} AS con_historia
         FROM productos p WHERE p.id = $1 AND p.sucursal = $2`,
      [id, req.sucursal]
    );
    if (h?.con_historia) {
      return res.status(409).json({
        message: 'Este producto ya tiene movimientos o se usó en notas, así que no se puede '
               + 'eliminar. Desactívalo para ocultarlo del inventario.',
      });
    }
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
