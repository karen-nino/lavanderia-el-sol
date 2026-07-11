import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS     = ['EN_ESPERA', 'EN_PROCESO', 'POR_PROCESAR', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA'];
// Estados con los que puede nacer una nota.
const ESTADOS_INICIALES   = ['EN_ESPERA', 'EN_PROCESO'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['PENDIENTE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande'];
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

// Promueve a POR_PROCESAR las notas EN_PROCESO cuya máquina ya cumplió su
// tiempo de lavado (en_uso_desde + minutos configurados en ajustes). El
// servidor es la fuente de verdad: se llama al leer notas para que el estado
// quede persistido en la base sin depender de ningún proceso en segundo plano.
async function promoverNotasPorProcesar() {
  await pool.query(
    `UPDATE notas n
        SET estado = 'POR_PROCESAR'
       FROM maquinas m, ajustes a
      WHERE a.id = 1
        AND n.maquina_id = m.id
        AND n.estado = 'EN_PROCESO'
        AND m.estado = 'en_uso'
        AND m.en_uso_desde IS NOT NULL
        AND NOW() >= m.en_uso_desde + ((
              CASE m.tipo
                WHEN 'secadora'       THEN COALESCE(a.tiempo_carga_secadora, 30)
                WHEN 'lavadora_jumbo' THEN COALESCE(a.tiempo_carga_jumbo, 45)
                ELSE COALESCE(a.tiempo_carga_mediana, 30)
              END) * interval '1 minute')`
  );
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
              m.nombre   AS maquina_nombre
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
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
              m.en_uso_desde AS maquina_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
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
       WHERE np.nota_id = $1
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

    res.json({ ...rows[0], productos, insumos_consumidos: movs, historial_estados: historial });
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
    precio_base,       // precio por carga en AUTOSERVICIO
    insumos   = [], // [{ insumo_id, cantidad }]  → movimientos_insumos
    productos = [], // [{ producto_id, cantidad }] → nota_productos
  } = req.body;

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
    // El "tamaño del encargo" (chico/grande) aplica a Ropa; los edredones usan
    // su propio catálogo de tamaños (tamano_edredon) y no requieren este campo.
    if (String(tipo_prenda).toUpperCase() !== 'EDREDON') {
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

  // Los IDs referenciados deben pertenecer a la sucursal activa.
  if (cliente_id && !(await perteneceASucursal('clientes', cliente_id, req.sucursal))) {
    return res.status(400).json({ message: 'cliente_id no existe.' });
  }
  if (maquina_id && !(await perteneceASucursal('maquinas', maquina_id, req.sucursal))) {
    return res.status(400).json({ message: 'maquina_id no existe.' });
  }

  const ajusteNum      = Number(ajuste)         || 0;
  const cantidadCargas = Number(cantidad_cargas) || 1;

  // Leer precio desde ajustes si no se envió en el body.
  // Depende del tipo de máquina (mediana / jumbo / secadora) y la modalidad
  // (EDREDON en jumbo tiene su propia tarifa).
  let precioBaseNum = precio_base != null ? Number(precio_base) : null;
  if (precioBaseNum === null) {
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

  // precio_total = (cargas × precio_base) + ajuste
  // Los productos se suman después de insertarlos en nota_productos.
  const precioFinal = precioBaseNum != null
    ? cantidadCargas * precioBaseNum + ajusteNum
    : (precio_total ? Number(precio_total) : null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, maquina_id, modalidad, tipo_prenda, estado, estado_pago, sucursal,
          peso_kg, precio_total, fecha_entrega, tiempo_entrega, instrucciones,
          tamano, tipo_tela, tamano_edredon, precio_base, ajuste, cantidad_cargas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        maquina_id   || null,
        modalidad,
        String(tipo_prenda).toUpperCase(),
        estadoInicial,
        estado_pago,
        req.sucursal,
        peso_kg      || null,
        precioFinal,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        instrucciones || null,
        tamano ? String(tamano).toLowerCase() : null,
        tipo_tela ? String(tipo_tela).trim() : null,
        tamano_edredon ? String(tamano_edredon).trim() : null,
        precioBaseNum,
        ajusteNum,
        cantidadCargas,
      ]
    );
    const nota = notaRows[0];

    const folio = generarFolio(nota.id, nota.created_at);
    await client.query('UPDATE notas SET folio = $1 WHERE id = $2', [folio, nota.id]);
    nota.folio = folio;

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

    // Si se insertaron productos, recalcular precio_total con fórmula completa
    if (productosInsertados.length > 0) {
      const { rows: totalRows } = await client.query(
        `UPDATE notas n
           SET precio_total = (
             SELECT (n2.cantidad_cargas * COALESCE(n2.precio_base, 0))
                  + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                  + n2.ajuste
             FROM notas n2
             LEFT JOIN nota_productos np ON np.nota_id = n2.id
             WHERE n2.id = $1
             GROUP BY n2.id, n2.cantidad_cargas, n2.precio_base, n2.ajuste
           )
         WHERE n.id = $1
         RETURNING precio_total`,
        [nota.id]
      );
      nota.precio_total = totalRows[0].precio_total;
    }

    await client.query('COMMIT');
    res.status(201).json({ ...nota, productos: productosInsertados });
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
    productos,
  } = req.body;

  if (productos !== undefined && !Array.isArray(productos)) {
    return res.status(400).json({ message: 'productos debe ser una lista.' });
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

    // Los productos solo se tocan si vienen en el body: la lista enviada
    // (aun vacía) reemplaza los de la nota; ausente, se conservan.
    let productosNota;
    if (productos !== undefined) {
      // Liberar stock reservado de productos actuales y eliminarlos
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
      await client.query('DELETE FROM nota_productos WHERE nota_id = $1', [id]);

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
         WHERE np.nota_id = $1
         ORDER BY np.created_at ASC`,
        [id]
      );
      productosNota = existentes;
    }

    const subtotalProductos = productosNota.reduce((s, p) => s + Number(p.subtotal), 0);
    const precioFinal = precioBaseNum != null
      ? cantidadCargasNum * precioBaseNum + ajusteNum + subtotalProductos
      : null;

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
         precio_total    = $15
       WHERE id = $1
       RETURNING *`,
      [
        id,
        tiene('cliente_id')     ? (cliente_id || null) : actual.cliente_id,
        tiene('maquina_id')     ? (maquina_id || null) : actual.maquina_id,
        estado_pago || actual.estado_pago,
        tiene('fecha_entrega')  ? (fecha_entrega || null) : actual.fecha_entrega,
        tiene('tiempo_entrega') ? (tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null) : actual.tiempo_entrega,
        tiene('instrucciones')  ? (instrucciones || null) : actual.instrucciones,
        tamano ? String(tamano).toLowerCase() : actual.tamano,
        tipo_prenda ? String(tipo_prenda).toUpperCase() : actual.tipo_prenda,
        tiene('tipo_tela')      ? (tipo_tela ? String(tipo_tela).trim() : null) : actual.tipo_tela,
        tiene('tamano_edredon') ? (tamano_edredon ? String(tamano_edredon).trim() : null) : actual.tamano_edredon,
        precioBaseNum,
        ajusteNum,
        cantidadCargasNum,
        precioFinal,
      ]
    );

    if (esReversionPago) {
      await registrarReversionPago(client, actual, req.user.id, req.sucursal);
    }

    await client.query('COMMIT');
    res.json({ ...rows[0], productos: productosNota });
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
      'SELECT maquina_id, estado FROM notas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [id, req.sucursal]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const { maquina_id: maquinaId, estado: estadoNota } = notaRows[0];

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

    // Liberar la máquina si estaba en uso por esta nota
    if (maquinaId) {
      await client.query(
        `UPDATE maquinas
           SET estado = 'disponible',
               en_uso_desde = NULL
         WHERE id = $1 AND estado = 'en_uso'`,
        [maquinaId]
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
// Activa una nota En Espera: le asigna máquina (si se indica),
// la pasa a En Proceso y marca la máquina como en uso.
export const activarNota = async (req, res) => {
  const { id } = req.params;
  const { maquina_id } = req.body;

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
    if (notaRows[0].estado !== 'EN_ESPERA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solo se puede activar una nota En Espera.' });
    }

    const maquinaFinal = maquina_id || notaRows[0].maquina_id;
    if (!maquinaFinal) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Se requiere una máquina para activar la nota.' });
    }

    const { rows: maqRows } = await client.query(
      'SELECT estado FROM maquinas WHERE id = $1 AND sucursal = $2 FOR UPDATE',
      [maquinaFinal, req.sucursal]
    );
    if (maqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no existe.' });
    }
    if (maqRows[0].estado !== 'disponible') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La máquina seleccionada no está disponible.' });
    }

    await client.query(
      `UPDATE maquinas SET estado = 'en_uso', en_uso_desde = NOW() WHERE id = $1`,
      [maquinaFinal]
    );
    await client.query(
      `UPDATE notas SET maquina_id = $1, estado = 'EN_PROCESO' WHERE id = $2`,
      [maquinaFinal, id]
    );

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
              m.en_uso_desde AS maquina_en_uso_desde
       FROM notas n
       LEFT JOIN clientes  c ON c.id = n.cliente_id
       JOIN      usuarios  u ON u.id = n.usuario_id
       LEFT JOIN maquinas  m ON m.id = n.maquina_id
       WHERE n.id = $1`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('activarNota error:', err);
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

    await client.query(
      `UPDATE notas n
         SET precio_total = (
           SELECT (n2.cantidad_cargas * COALESCE(n2.precio_base, 0))
                + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                + n2.ajuste
           FROM notas n2
           LEFT JOIN nota_productos np ON np.nota_id = n2.id
           WHERE n2.id = $1
           GROUP BY n2.id, n2.cantidad_cargas, n2.precio_base, n2.ajuste
         )
       WHERE n.id = $1`,
      [id]
    );

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

    await client.query(
      `UPDATE notas n
         SET precio_total = (
           SELECT (n2.cantidad_cargas * COALESCE(n2.precio_base, 0))
                + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                + n2.ajuste
           FROM notas n2
           LEFT JOIN nota_productos np ON np.nota_id = n2.id
           WHERE n2.id = $1
           GROUP BY n2.id, n2.cantidad_cargas, n2.precio_base, n2.ajuste
         )
       WHERE n.id = $1`,
      [id]
    );

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
