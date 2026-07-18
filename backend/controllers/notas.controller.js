import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'EN_PROCESO', 'POR_PROCESAR', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
// Estados con los que puede nacer una nota.
const ESTADOS_INICIALES   = ['EN_ESPERA', 'EN_PROCESO'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande', 'jumbo'];
const TIPOS_PRENDA_VALIDOS = ['ROPA', 'EDREDON'];
const TIEMPOS_ENTREGA_VALIDOS = ['MANANA', 'TARDE', 'NOCHE'];

// Transiciones permitidas por estado actual
const TRANSICIONES_VALIDAS = {
  EN_ESPERA:    ['EN_PROCESO', 'LISTA',  'CANCELADA'],
  EN_PROCESO:   ['POR_PROCESAR', 'LISTA', 'CANCELADA'],
  POR_PROCESAR: ['LISTA',                'CANCELADA'],
  LISTA:        ['PAGADA',  'FINALIZADA', 'CANCELADA'],
  PAGADA:       ['FINALIZADA',            'CANCELADA'],
  FINALIZADA:   [],
  CANCELADA:    [],
};

// Subconsulta con los IDs de todas las máquinas vinculadas a la nota `n`:
// las de sus cargas (autoservicio, tabla nota_cargas) más las columnas
// legadas maquina_id / secadora_id (Por Encargo y notas viejas).
const SQL_MAQUINAS_DE_NOTA = `
  SELECT nc.lavadora_id AS mid FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT nc.secadora_id FROM nota_cargas nc WHERE nc.nota_id = n.id
  UNION SELECT n.maquina_id
  UNION SELECT n.secadora_id`;

// Promueve a POR_PROCESAR las notas EN_PROCESO cuyas máquinas ya cumplieron
// su tiempo de ciclo (en_uso_desde + minutos configurados en ajustes). Con
// varias máquinas por nota, se promueve cuando TODAS las que siguen en uso
// terminaron su ciclo. El servidor es la fuente de verdad: se llama al leer
// notas para que el estado quede persistido sin procesos en segundo plano.
async function promoverNotasPorProcesar() {
  await pool.query(
    `UPDATE notas n
        SET estado = 'POR_PROCESAR'
      WHERE n.estado = 'EN_PROCESO'
        AND EXISTS (
          SELECT 1 FROM maquinas m
           WHERE m.estado = 'en_uso'
             AND m.id IN (${SQL_MAQUINAS_DE_NOTA})
        )
        AND NOT EXISTS (
          SELECT 1 FROM maquinas m CROSS JOIN ajustes a
           WHERE a.id = 1
             AND m.estado = 'en_uso'
             AND m.id IN (${SQL_MAQUINAS_DE_NOTA})
             AND (m.en_uso_desde IS NULL
                  OR NOW() < m.en_uso_desde + ((
                       CASE m.tipo
                         WHEN 'secadora'       THEN COALESCE(a.tiempo_carga_secadora, 30)
                         WHEN 'lavadora_jumbo' THEN COALESCE(a.tiempo_carga_jumbo, 45)
                         ELSE COALESCE(a.tiempo_carga_mediana, 30)
                       END) * interval '1 minute'))
        )`
  );
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
            precio_carga_secadora, precio_edredon_jumbo
       FROM ajustes WHERE id = 1`
  );
  const c = rows[0] ?? {};
  return {
    mediana:      c.precio_carga_mediana  != null ? Number(c.precio_carga_mediana)  : 70,
    jumbo:        c.precio_carga_jumbo    != null ? Number(c.precio_carga_jumbo)    : 70,
    secadora:     c.precio_carga_secadora != null ? Number(c.precio_carga_secadora) : 45,
    edredonJumbo: c.precio_edredon_jumbo  != null ? Number(c.precio_edredon_jumbo)  : 80,
  };
}

function tarifaLavadora(tipoMaquina, tipoPrenda, t) {
  if (tipoMaquina === 'lavadora_jumbo') {
    return String(tipoPrenda).toUpperCase() === 'EDREDON' ? t.edredonJumbo : t.jumbo;
  }
  return t.mediana;
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
  if (ids.length > 0) {
    const { rows } = await client.query(
      'SELECT id, tipo FROM maquinas WHERE id = ANY($1) AND sucursal = $2',
      [ids, sucursal]
    );
    rows.forEach(r => tipoPorId.set(Number(r.id), r.tipo));
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
      precio_secadora: secadoraId ? t.secadora : 0,
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
         (nota_id, orden, lavadora_id, secadora_id, precio_lavadora, precio_secadora,
          tipo_prenda, tipo_tela, tamano_edredon, tamano, ajuste)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
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
            nc.precio_lavadora, nc.precio_secadora,
            nc.tipo_prenda, nc.tipo_tela, nc.tamano_edredon, nc.tamano, nc.ajuste,
            ml.nombre AS lavadora_nombre, ml.tipo AS lavadora_tipo, ml.estado AS lavadora_estado,
            ms.nombre AS secadora_nombre, ms.tipo AS secadora_tipo, ms.estado AS secadora_estado
       FROM nota_cargas nc
       LEFT JOIN maquinas ml ON ml.id = nc.lavadora_id
       LEFT JOIN maquinas ms ON ms.id = nc.secadora_id
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
    await promoverNotasPorProcesar();
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
                WHERE x.mid IS NOT NULL) AS maquinas_ids
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
    await promoverNotasPorProcesar();
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
  // Estado inicial: EN_PROCESO por defecto; EN_ESPERA si así se indica.
  const estadoInicial = estado || 'EN_PROCESO';

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
      ? (idsActivar.length > 0 ? 'EN_PROCESO' : 'EN_ESPERA')
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

      if (['EN_PROCESO', 'POR_PROCESAR'].includes(actual.estado)) {
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
      'SELECT estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

// ── PATCH /notas/:id/activar ────────────────────────────────
// Activa una nota En Espera y la pasa a En Proceso tomando sus máquinas.
// Autoservicio: el body puede traer `cargas` ([{ lavadora_id, secadora_id }]
// por carga) que reemplazan las de la nota. Por Encargo / legado: body con
// maquina_id / secadora_id directos.
export const activarNota = async (req, res) => {
  const { id } = req.params;
  const { maquina_id, secadora_id, cargas } = req.body;

  if (cargas !== undefined && (!Array.isArray(cargas) || cargas.length === 0)) {
    return res.status(400).json({ message: 'cargas debe ser una lista con al menos una carga.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      'SELECT estado, maquina_id, secadora_id, tipo_prenda FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    if (notaRows[0].estado !== 'EN_ESPERA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede activar una nota En Espera.' });
    }

    if (cargas !== undefined) {
      // Se ACTUALIZAN las máquinas de las cargas existentes por posición (sin
      // borrarlas), para conservar sus atributos y productos —clave en encargo—.
      const { rows: existentes } = await client.query(
        'SELECT * FROM nota_cargas WHERE nota_id = $1 ORDER BY orden ASC FOR UPDATE',
        [id]
      );
      if (existentes.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La nota no tiene cargas.' });
      }
      const nuevas = existentes.map((carga, i) => {
        const src = cargas[i] || {};
        return {
          id:          carga.id,
          tipo_prenda: carga.tipo_prenda,
          lavadora_id: src.lavadora_id ? Number(src.lavadora_id) : (carga.lavadora_id ?? null),
          secadora_id: src.secadora_id ? Number(src.secadora_id) : (carga.secadora_id ?? null),
        };
      });
      const ids = [...new Set(nuevas.flatMap(n => [n.lavadora_id, n.secadora_id]).filter(Boolean))];
      if (ids.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Se requiere al menos una máquina para activar la nota.' });
      }
      const { rows: maqs } = await client.query(
        'SELECT id, nombre, tipo, estado FROM maquinas WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
        [ids, req.sucursal]
      );
      const maqById = new Map(maqs.map(m => [Number(m.id), m]));
      if (ids.some(x => !maqById.has(x))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Una máquina seleccionada no existe.' });
      }
      // Validar tipos por carga (según su propia prenda) y disponibilidad.
      for (const n of nuevas) {
        if (n.lavadora_id && maqById.get(n.lavadora_id).tipo === 'secadora') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'La máquina de lavado no es una lavadora.' });
        }
        if (n.secadora_id && maqById.get(n.secadora_id).tipo !== 'secadora') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'La máquina de secado no es una secadora.' });
        }
        if (n.tipo_prenda === 'EDREDON' && n.lavadora_id && maqById.get(n.lavadora_id).tipo !== 'lavadora_jumbo') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Los edredones solo van en lavadora jumbo.' });
        }
      }
      const ocupadaId = ids.find(x => maqById.get(x).estado !== 'disponible');
      if (ocupadaId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `La máquina ${maqById.get(ocupadaId).nombre} no está disponible.` });
      }

      const t = await tarifasCarga(client);
      for (const n of nuevas) {
        await client.query(
          `UPDATE nota_cargas SET lavadora_id = $1, secadora_id = $2, precio_lavadora = $3, precio_secadora = $4 WHERE id = $5`,
          [
            n.lavadora_id,
            n.secadora_id,
            n.lavadora_id ? tarifaLavadora(maqById.get(n.lavadora_id).tipo, n.tipo_prenda, t) : 0,
            n.secadora_id ? t.secadora : 0,
            n.id,
          ]
        );
      }
      await client.query(
        `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
        [ids]
      );
      await client.query(
        `UPDATE notas
            SET maquina_id  = $1,
                secadora_id = $2,
                estado = 'EN_PROCESO'
          WHERE id = $3`,
        [
          nuevas.find(n => n.lavadora_id)?.lavadora_id ?? null,
          nuevas.find(n => n.secadora_id)?.secadora_id ?? null,
          id,
        ]
      );
      await recalcularPrecioTotal(client, id);
    } else {
      // Legado / Por Encargo: una lavadora y/o secadora directas.
      const lavadoraFinal = maquina_id  || notaRows[0].maquina_id;
      const secadoraFinal = secadora_id || notaRows[0].secadora_id;
      const maquinas = [lavadoraFinal, secadoraFinal].filter(Boolean);
      if (maquinas.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Se requiere al menos una máquina para activar la nota.' });
      }

      // Validar disponibilidad de cada máquina antes de tomar ninguna.
      for (const mid of maquinas) {
        const { rows: maqRows } = await client.query(
          'SELECT estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
          [mid, req.sucursal]
        );
        if (maqRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'La máquina seleccionada no existe.' });
        }
        if (maqRows[0].estado !== 'disponible') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'La máquina seleccionada no está disponible.' });
        }
      }

      await client.query(
        `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
        [maquinas]
      );
      await client.query(
        `UPDATE notas SET maquina_id = $1, secadora_id = $2, estado = 'EN_PROCESO' WHERE id = $3`,
        [lavadoraFinal || null, secadoraFinal || null, id]
      );
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
    console.error('activarNota error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/activar-pendientes ─────────────────────
// Activa (marca en uso) todas las máquinas ya asignadas a la nota que sigan
// disponibles. Sirve para poner en marcha las cargas que quedaron en espera,
// tanto en una nota En Espera como en una nota ya En Proceso (caso mixto).
export const activarMaquinasPendientes = async (req, res) => {
  const { id } = req.params;
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
    const libres = maqs.filter(m => m.estado === 'disponible').map(m => m.id);
    if (libres.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No hay máquinas pendientes por activar.' });
    }

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = ANY($1)`,
      [libres]
    );
    if (notaRows[0].estado === 'EN_ESPERA') {
      await client.query(`UPDATE notas SET estado = 'EN_PROCESO' WHERE id = $1`, [id]);
    }

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
    if (!['EN_PROCESO', 'POR_PROCESAR'].includes(nota.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede asignar una secadora a una nota en proceso.' });
    }

    // La secadora se agrega a las primeras N cargas que no tienen una.
    const { rows: sinSecadora } = await client.query(
      `SELECT id FROM nota_cargas
        WHERE nota_id = $1 AND secadora_id IS NULL
        ORDER BY orden ASC
        FOR UPDATE`,
      [id]
    );
    if (sinSecadora.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nota no tiene cargas sin secadora.' });
    }
    const objetivo = sinSecadora.slice(0, cargasPedidas).map(r => r.id);

    const { rows: maqRows } = await client.query(
      'SELECT tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    const tarifaSecadora = (await tarifasCarga(client)).secadora;

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    await client.query(
      `UPDATE nota_cargas SET secadora_id = $1, precio_secadora = $2 WHERE id = ANY($3)`,
      [secadora_id, tarifaSecadora, objetivo]
    );
    // Denormalización: la primera secadora de la nota, para lista y vistas legadas.
    await client.query(
      `UPDATE notas SET secadora_id = COALESCE(secadora_id, $1) WHERE id = $2`,
      [secadora_id, id]
    );
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
    console.error('asignarSecadora error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
};

// ── PATCH /notas/:id/terminar-lavado ────────────────────────
// Termina el lavado de UNA lavadora de la nota y arranca su secado: libera
// esa lavadora, marca en uso la secadora elegida (obligatoria) y la asigna a
// las cargas que lavó esa lavadora. Cada carga es independiente: las demás
// lavadoras de la nota no se tocan. No cambia el precio: la tarifa cobrada
// ya incluye el secado. La nota pasa a LISTA cuando su última secadora
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
    if (!['EN_PROCESO', 'POR_PROCESAR'].includes(notaRows[0].estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede terminar el lavado de una nota en proceso.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT tipo, estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
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

    // La secadora hereda las cargas de esa lavadora (sin costo extra: el
    // precio_secadora de las cargas no se toca)...
    await client.query(
      `UPDATE nota_cargas SET secadora_id = $1
        WHERE nota_id = $2 AND lavadora_id = $3 AND secadora_id IS NULL`,
      [secadora_id, id, lavadora_id]
    );
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

    // La secadora entra en uso y su ciclo arranca ahora.
    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [secadora_id]
    );
    // Denormalización: maquina_id apunta a alguna lavadora que siga en la
    // nota (o NULL si esta era la última); secadora_id, a la primera secadora.
    await client.query(
      `UPDATE notas
          SET maquina_id = (SELECT nc.lavadora_id FROM nota_cargas nc
                             WHERE nc.nota_id = $2 AND nc.lavadora_id IS NOT NULL
                             ORDER BY nc.orden ASC LIMIT 1),
              secadora_id = COALESCE(secadora_id, $1),
              estado = 'EN_PROCESO'
        WHERE id = $2`,
      [secadora_id, id]
    );

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
    if (!['EN_PROCESO', 'POR_PROCESAR'].includes(notaRows[0].estado)) {
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
