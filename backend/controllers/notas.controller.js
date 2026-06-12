import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

const ESTADOS_VALIDOS     = ['ACTIVA', 'EN_PROCESO', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'];
const MODALIDADES_VALIDAS = ['AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO'];
const ESTADOS_PAGO_VALIDOS = ['DEBE', 'PAGADO'];
const TAMANOS_VALIDOS     = ['chico', 'grande'];
const TIEMPOS_ENTREGA_VALIDOS = ['MANANA', 'TARDE', 'NOCHE'];

// Transiciones permitidas por estado actual
const TRANSICIONES_VALIDAS = {
  ACTIVA:     ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['LISTA',      'CANCELADA'],
  LISTA:      ['PAGADA',     'CANCELADA'],
  PAGADA:     ['ENTREGADA',  'CANCELADA'],
  ENTREGADA:  [],
  CANCELADA:  [],
};

function generarFolio(id, fecha) {
  const d = new Date(fecha);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const seq  = String(id).padStart(4, '0');
  return `${seq}-${dd}${mm}${yyyy}`;
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
       ORDER BY n.created_at DESC`
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
       WHERE n.id = $1`,
      [id]
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

    res.json({ ...rows[0], productos, insumos_consumidos: movs });
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
    estado_pago,
    sucursal = 'lopez_cotilla',
    descripcion,
    peso_kg,
    precio_total,
    fecha_entrega,
    tiempo_entrega,
    notas,
    tamano,
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
  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }
  if (modalidad === 'POR_ENCARGO') {
    if (!cliente_id) {
      return res.status(400).json({ message: 'cliente_id es requerido para notas Por Encargo.' });
    }
    if (!tamano || !TAMANOS_VALIDOS.includes(String(tamano).toLowerCase())) {
      return res.status(400).json({ message: 'tamano es requerido para Por Encargo (chico o grande).' });
    }
  }
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `tiempo_entrega inválido. Valores permitidos: ${TIEMPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }

  const ajusteNum      = Number(ajuste)         || 0;
  const cantidadCargas = Number(cantidad_cargas) || 1;

  // Leer precio desde configuracion si no se envió en el body
  let precioBaseNum = precio_base != null ? Number(precio_base) : null;
  if (modalidad === 'AUTOSERVICIO' && precioBaseNum === null) {
    const { rows: cfg } = await pool.query(
      'SELECT precio_autoservicio FROM configuracion WHERE id = 1'
    );
    precioBaseNum = cfg.length > 0 ? Number(cfg[0].precio_autoservicio) : 70;
  }

  // Para AUTOSERVICIO: precio_total = (cargas × precio_base) + ajuste
  // Los productos se suman después de insertarlos en nota_productos
  let precioFinal;
  if (modalidad === 'AUTOSERVICIO') {
    precioFinal = precioBaseNum != null
      ? cantidadCargas * precioBaseNum + ajusteNum
      : (precio_total ? Number(precio_total) : null);
  } else {
    precioFinal = precioBaseNum != null ? precioBaseNum + ajusteNum : null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: notaRows } = await client.query(
      `INSERT INTO notas
         (cliente_id, usuario_id, maquina_id, modalidad, estado_pago, sucursal,
          descripcion, peso_kg, precio_total, fecha_entrega, tiempo_entrega, notas,
          tamano, precio_base, ajuste, cantidad_cargas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        cliente_id   || null,
        req.user.id,
        maquina_id   || null,
        modalidad,
        estado_pago,
        sucursal,
        descripcion  || null,
        peso_kg      || null,
        precioFinal,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        notas        || null,
        tamano ? String(tamano).toLowerCase() : null,
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
          'SELECT stock_actual FROM insumos WHERE id = $1 FOR UPDATE',
          [insumo_id]
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
        'SELECT * FROM productos WHERE id = $1 FOR UPDATE',
        [producto_id]
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
             SELECT (n2.cantidad_cargas * c.precio_autoservicio)
                  + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                  + n2.ajuste
             FROM notas n2
             CROSS JOIN configuracion c
             LEFT JOIN nota_productos np ON np.nota_id = n2.id
             WHERE n2.id = $1 AND c.id = 1
             GROUP BY n2.id, n2.cantidad_cargas, c.precio_autoservicio, n2.ajuste
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
    descripcion,
    fecha_entrega,
    tiempo_entrega,
    notas,
    tamano,
    ajuste,
    cantidad_cargas,
    precio_base,
    productos = [],
  } = req.body;

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
  if (tiempo_entrega && !TIEMPOS_ENTREGA_VALIDOS.includes(String(tiempo_entrega).toUpperCase())) {
    return res.status(400).json({
      message: `tiempo_entrega inválido. Valores permitidos: ${TIEMPOS_ENTREGA_VALIDOS.join(', ')}.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      'SELECT * FROM notas WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (currentRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    const actual = currentRows[0];

    if (['PAGADA', 'ENTREGADA', 'CANCELADA'].includes(actual.estado)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `No se puede editar una nota en estado ${actual.estado}.`,
      });
    }

    const ajusteNum = Number(ajuste) || 0;
    const cantidadCargasNum = Number(cantidad_cargas) || 1;
    const precioBaseNum = precio_base != null && precio_base !== ''
      ? Number(precio_base)
      : actual.precio_base != null ? Number(actual.precio_base) : null;

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
        'SELECT * FROM productos WHERE id = $1 FOR UPDATE',
        [producto_id]
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

    const subtotalProductos = productosInsertados.reduce((s, p) => s + Number(p.subtotal), 0);
    let precioFinal;
    if (actual.modalidad === 'AUTOSERVICIO') {
      precioFinal = precioBaseNum != null
        ? cantidadCargasNum * precioBaseNum + ajusteNum + subtotalProductos
        : null;
    } else {
      precioFinal = (precioBaseNum != null ? precioBaseNum : 0) + ajusteNum + subtotalProductos;
    }

    const { rows } = await client.query(
      `UPDATE notas SET
         cliente_id      = $2,
         maquina_id      = $3,
         estado_pago     = COALESCE($4, estado_pago),
         descripcion     = $5,
         fecha_entrega   = $6,
         tiempo_entrega  = $7,
         notas           = $8,
         tamano          = COALESCE($9, tamano),
         precio_base     = $10,
         ajuste          = $11,
         cantidad_cargas = $12,
         precio_total    = $13
       WHERE id = $1
       RETURNING *`,
      [
        id,
        cliente_id || null,
        maquina_id || null,
        estado_pago || null,
        descripcion || null,
        fecha_entrega || null,
        tiempo_entrega ? String(tiempo_entrega).toUpperCase() : null,
        notas || null,
        tamano ? String(tamano).toLowerCase() : null,
        precioBaseNum,
        ajusteNum,
        cantidadCargasNum,
        precioFinal,
      ]
    );

    await client.query('COMMIT');
    res.json({ ...rows[0], productos: productosInsertados });
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

    // Liberar stock reservado antes de eliminar
    await client.query(
      `UPDATE productos a
         SET stock_reservado = stock_reservado - np.cantidad
       FROM nota_productos np
       WHERE np.nota_id = $1 AND np.producto_id = a.id`,
      [id]
    );

    const { rowCount } = await client.query('DELETE FROM notas WHERE id = $1', [id]);
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
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
      'SELECT estado FROM notas WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (notaRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }

    const estadoActual = notaRows[0].estado;

    if (['ENTREGADA', 'CANCELADA'].includes(estadoActual)) {
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
      await client.query(
        `UPDATE productos a
           SET stock_reservado = stock_reservado - np.cantidad
         FROM nota_productos np
         WHERE np.nota_id = $1 AND np.producto_id = a.id`,
        [id]
      );
    } else if (estado === 'PAGADA') {
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

// ── PATCH /notas/:id/estado-pago ────────────────────────────
export const cambiarEstadoPago = async (req, res) => {
  const { id } = req.params;
  const { estado_pago } = req.body;

  if (!estado_pago || !ESTADOS_PAGO_VALIDOS.includes(estado_pago)) {
    return res.status(400).json({
      message: `Estado de pago inválido. Valores permitidos: ${ESTADOS_PAGO_VALIDOS.join(', ')}.`,
    });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE notas SET estado_pago = $1 WHERE id = $2 RETURNING *',
      [estado_pago, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Nota no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('cambiarEstadoPago error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
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
       WHERE np.nota_id = $1
       ORDER BY np.created_at ASC`,
      [id]
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

    const { rows: artRows } = await client.query(
      'SELECT * FROM productos WHERE id = $1 FOR UPDATE',
      [producto_id]
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
           SELECT (n2.cantidad_cargas * c.precio_autoservicio)
                + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                + n2.ajuste
           FROM notas n2
           CROSS JOIN configuracion c
           LEFT JOIN nota_productos np ON np.nota_id = n2.id
           WHERE n2.id = $1 AND c.id = 1
           GROUP BY n2.id, n2.cantidad_cargas, c.precio_autoservicio, n2.ajuste
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
      'SELECT * FROM nota_productos WHERE nota_id = $1 AND producto_id = $2',
      [id, productoId]
    );
    if (npRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Producto no encontrado en la nota.' });
    }
    const np = npRows[0];

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
           SELECT (n2.cantidad_cargas * c.precio_autoservicio)
                + COALESCE(SUM(np.cantidad * np.precio_unitario), 0)
                + n2.ajuste
           FROM notas n2
           CROSS JOIN configuracion c
           LEFT JOIN nota_productos np ON np.nota_id = n2.id
           WHERE n2.id = $1 AND c.id = 1
           GROUP BY n2.id, n2.cantidad_cargas, c.precio_autoservicio, n2.ajuste
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
