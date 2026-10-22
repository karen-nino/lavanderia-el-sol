import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

/**
 * Fábrica del CRUD de los catálogos simples de Ajustes (nombre + activo + orden):
 * tipos de tela, tamaños de edredón, marcas, graneles, bolsas…
 *
 * @param {string} tabla
 * @param nombres palabras con que el usuario conoce el catálogo, para los mensajes.
 * @param {string[]} banderas columnas BOOLEAN propias; se declaran aquí porque
 *   sus nombres entran al SQL.
 * @param opciones.alRenombrar (client, viejo, nuevo) para el catálogo cuyo nombre
 *   se copia en otra tabla; corre en la misma transacción.
 * @param opciones.conPrecio agrega `precio` (vacío = sin precio; si no, >= 0).
 * @param opciones.enteros columnas de conteo (enteros >= 0).
 */
function crearControladorEtiqueta(tabla, nombres, banderas = [], { alRenombrar, conPrecio = false, enteros = [] } = {}) {
  // undefined = no se manda; { error } si no es un entero de 0 o más.
  const leerEntero = (v) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (v === null || v === '' || !Number.isInteger(n) || n < 0) {
      return { error: 'Las medidas y las bolsas deben ser un número entero de 0 o más.' };
    }
    return n;
  };
  // undefined = no se manda; null = sin precio; { error } si no es válido.
  const leerPrecio = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: 'El precio debe ser un número mayor o igual a 0.' };
    return n;
  };

  const getAll = async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM ${tabla} ORDER BY orden ASC NULLS LAST, id ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error(`get ${tabla} error:`, err);
      res.status(500).json({ message: `No se pudieron cargar ${nombres.plural}. Intenta de nuevo.` });
    }
  };

  const create = async (req, res) => {
    if (!esAdmin(req.user.rol)) {
      return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
    }
    const nombre = String(req.body.nombre ?? '').trim();
    if (!nombre) {
      return res.status(400).json({ message: 'El nombre es requerido.' });
    }
    const precio = conPrecio ? leerPrecio(req.body.precio) : undefined;
    if (precio?.error) {
      return res.status(400).json({ message: precio.error });
    }
    try {
      // Va al final del orden; las banderas toman su valor del body (o false).
      const extras = [...banderas.map(b => [b, Boolean(req.body[b])]),
                      ...(conPrecio ? [['precio', precio ?? null]] : [])];
      const cols = extras.map(([c]) => `, ${c}`).join('');
      const vals = extras.map((_, k) => `, $${k + 2}`).join('');
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (nombre, orden${cols})
         VALUES ($1, (SELECT COALESCE(MAX(orden), 0) + 1 FROM ${tabla})${vals})
         RETURNING *`,
        [nombre, ...extras.map(([, v]) => v)]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: `Ya existe ${nombres.uno} con ese nombre.` });
      }
      console.error(`create ${tabla} error:`, err);
      res.status(500).json({ message: `No se pudo guardar ${nombres.singular}. Intenta de nuevo.` });
    }
  };

  const update = async (req, res) => {
    if (!esAdmin(req.user.rol)) {
      return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
    }
    const { id } = req.params;
    // Un id no numérico daría 500 en Postgres: se responde 404.
    if (!/^\d+$/.test(String(id))) {
      return res.status(404).json({ message: `No se encontró ${nombres.singular}.` });
    }
    const { nombre, activo } = req.body;

    const updates = [];
    const values  = [];
    let i = 1;

    if (nombre !== undefined) {
      const limpio = String(nombre).trim();
      if (!limpio) {
        return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
      }
      updates.push(`nombre = $${i++}`);
      values.push(limpio);
    }
    if (activo !== undefined) {
      updates.push(`activo = $${i++}`);
      values.push(Boolean(activo));
    }
    for (const bandera of banderas) {
      if (req.body[bandera] !== undefined) {
        updates.push(`${bandera} = $${i++}`);
        values.push(Boolean(req.body[bandera]));
      }
    }
    for (const campo of enteros) {
      const n = leerEntero(req.body[campo]);
      if (n?.error) {
        return res.status(400).json({ message: n.error });
      }
      if (n !== undefined) {
        updates.push(`${campo} = $${i++}`);
        values.push(n);
      }
    }
    if (conPrecio) {
      const precio = leerPrecio(req.body.precio);
      if (precio?.error) {
        return res.status(400).json({ message: precio.error });
      }
      if (precio !== undefined) {
        updates.push(`precio = $${i++}`);
        values.push(precio);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No hay cambios que guardar.' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const antes = await client.query(`SELECT nombre FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id]);
      const { rows } = await client.query(
        `UPDATE ${tabla} SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: `No se encontró ${nombres.singular}.` });
      }
      const viejo = antes.rows[0]?.nombre;
      if (alRenombrar && viejo != null && viejo !== rows[0].nombre) {
        await alRenombrar(client, viejo, rows[0].nombre);
      }
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ message: `Ya existe ${nombres.uno} con ese nombre.` });
      }
      console.error(`update ${tabla} error:`, err);
      res.status(500).json({ message: `No se pudieron guardar los cambios de ${nombres.singular}. Intenta de nuevo.` });
    } finally {
      client.release();
    }
  };

  // Reordena el catálogo: { ids } en el nuevo orden, en una transacción.
  const reorder = async (req, res) => {
    if (!esAdmin(req.user.rol)) {
      return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (ids.length === 0) {
      return res.status(400).json({ message: 'No llegó el nuevo orden de la lista. Intenta de nuevo.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `UPDATE ${tabla} SET orden = $1, updated_at = NOW() WHERE id = $2`,
          [i + 1, ids[i]]
        );
      }
      await client.query('COMMIT');
      const { rows } = await client.query(
        `SELECT * FROM ${tabla} ORDER BY orden ASC NULLS LAST, id ASC`
      );
      res.json(rows);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`reorder ${tabla} error:`, err);
      res.status(500).json({ message: `No se pudo guardar el nuevo orden de ${nombres.plural}. Intenta de nuevo.` });
    } finally {
      client.release();
    }
  };

  return { getAll, create, update, reorder };
}

export const tiposTela = crearControladorEtiqueta('tipos_tela', {
  singular: 'el tipo de tela', plural: 'los tipos de tela', uno: 'un tipo de tela',
});
/** Cada tamaño de edredón es un servicio Por Encargo, con su precio y precarga. */
export const tamanosEdredon = crearControladorEtiqueta('tamanos_edredon', {
  singular: 'el tamaño de edredón', plural: 'los tamaños de edredón', uno: 'un tamaño de edredón',
}, [], { conPrecio: true, enteros: ['precarga_medidas', 'precarga_bolsas'] });
export const marcasProducto = crearControladorEtiqueta('marcas_producto', {
  singular: 'la marca', plural: 'las marcas', uno: 'una marca',
});
export const envasesProducto = crearControladorEtiqueta('envases_producto', {
  singular: 'el envase', plural: 'los envases', uno: 'un envase',
});
/** Marcas de máquina. */
export const marcasMaquina = crearControladorEtiqueta('marcas_maquina', {
  singular: 'la marca', plural: 'las marcas', uno: 'una marca',
});
/**
 * Nombres de los líquidos a granel ("Persil", "Suavizante"). El producto granel
 * toma su nombre de aquí: renombrar aquí renombra sus productos.
 */
export const granelesProducto = crearControladorEtiqueta('graneles_producto', {
  singular: 'el granel', plural: 'los graneles', uno: 'un granel',
}, [], {
  alRenombrar: (client, viejo, nuevo) => client.query(
    `UPDATE productos SET nombre = $1, updated_at = NOW()
      WHERE tipo_liquido = 'granel' AND clase <> 'bolsa' AND lower(nombre) = lower($2)`,
    [nuevo, viejo]
  ),
});
/**
 * Tipos de granel (Jabón, Suavizante…). Cada producto granel tiene uno; un
 * servicio Por Encargo lleva medidas de cada tipo y en Salidas se elige el producto.
 */
export const tiposGranel = crearControladorEtiqueta('tipos_granel', {
  singular: 'el tipo de granel', plural: 'los tipos de granel', uno: 'un tipo de granel',
});
/** Tamaños de bolsa. La bolsa guarda el nombre: renombrar aquí la renombra. */
export const tamanosBolsa = crearControladorEtiqueta('tamanos_bolsa', {
  singular: 'el tamaño de bolsa', plural: 'los tamaños de bolsa', uno: 'un tamaño de bolsa',
}, [], {
  alRenombrar: (client, viejo, nuevo) => client.query(
    `UPDATE productos SET tamano_bolsa = $1, updated_at = NOW()
      WHERE clase = 'bolsa' AND lower(tamano_bolsa) = lower($2)`,
    [nuevo, viejo]
  ),
});

/** Tipo y tamaño válidos de un modelo o de un tiempo por marca. */
const TIPOS_TIEMPO = ['lavadora', 'secadora'];
const TAMANOS_TIEMPO = ['mediana', 'jumbo'];

// ── Modelos de máquina ──────────────────────────────────────────────────────
// Cuelgan de una marca (todo se filtra por `marca_id`); por lo demás son un
// catálogo más (solo admin). Tipo y tamaño lo ubican en su bloque de Ajustes;
// sus tiempos se guardan desde ese bloque (guardarTiempoMarca).

/** Minutos del formulario: vacío = sin tiempo propio; si no, entero positivo. { valor } | { error }. */
function leerMinutos(minutos) {
  if (minutos === null || minutos === undefined || minutos === '') return { valor: null };
  const n = Number(minutos);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: 'El tiempo debe ser un número de minutos mayor que cero.' };
  }
  return { valor: n };
}

/**
 * Modelos (o los de `?marca_id=`), con el nombre de su marca: la máquina guarda
 * nombres, no ids.
 */
export const getModelosMaquina = async (req, res) => {
  const { marca_id: marcaId } = req.query;
  if (marcaId !== undefined && !/^\d+$/.test(String(marcaId))) {
    return res.status(400).json({ message: 'Elige una marca válida.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT mo.*, mm.nombre AS marca
         FROM modelos_maquina mo
         JOIN marcas_maquina mm ON mm.id = mo.marca_id
        WHERE $1::int IS NULL OR mo.marca_id = $1::int
        ORDER BY mm.orden ASC NULLS LAST, mm.id ASC,
                 mo.orden ASC NULLS LAST, mo.id ASC`,
      [marcaId ?? null]
    );
    res.json(rows);
  } catch (err) {
    console.error('getModelosMaquina error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los modelos. Intenta de nuevo.' });
  }
};

export const crearModeloMaquina = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { marca_id: marcaId } = req.body;
  if (!/^\d+$/.test(String(marcaId))) {
    return res.status(400).json({ message: 'Elige una marca válida.' });
  }
  const nombre = String(req.body.nombre ?? '').trim();
  if (!nombre) {
    return res.status(400).json({ message: 'El nombre es requerido.' });
  }
  const { tipo, tamano, pregunta_tiempo, dos_ciclos, solo_fichas, fichas_sonoff } = req.body;
  if (!TIPOS_TIEMPO.includes(tipo)) {
    return res.status(400).json({ message: 'El tipo de máquina debe ser lavadora o secadora.' });
  }
  if (!TAMANOS_TIEMPO.includes(tamano)) {
    return res.status(400).json({ message: 'El tamaño debe ser mediana o jumbo.' });
  }
  const minutos = leerMinutos(req.body.minutos);
  if (minutos.error) return res.status(400).json({ message: minutos.error });

  try {
    // El orden es dentro de la marca.
    const { rows } = await pool.query(
      `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, pregunta_tiempo, dos_ciclos, solo_fichas,
                                    fichas_sonoff, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               (SELECT COALESCE(MAX(orden), 0) + 1 FROM modelos_maquina WHERE marca_id = $1))
       RETURNING *`,
      // El de fichas sin Sonoff no tiene programas ni fichas con Sonoff.
      [marcaId, nombre, tipo, tamano, minutos.valor,
       Boolean(pregunta_tiempo) && !solo_fichas, Boolean(dos_ciclos), Boolean(solo_fichas),
       Boolean(fichas_sonoff) && !solo_fichas]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Esa marca ya tiene un modelo con ese nombre.' });
    }
    if (err.code === '23503') {
      return res.status(404).json({ message: 'Esa marca ya no existe.' });
    }
    console.error('crearModeloMaquina error:', err);
    res.status(500).json({ message: 'No se pudo guardar el modelo. Intenta de nuevo.' });
  }
};

export const actualizarModeloMaquina = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { id } = req.params;
  if (!/^\d+$/.test(String(id))) {
    return res.status(404).json({ message: 'No se encontró el modelo.' });
  }
  const { nombre, activo, tipo, tamano, minutos, pregunta_tiempo, dos_ciclos, solo_fichas, fichas_sonoff } = req.body;

  const updates = [];
  const values  = [];
  let i = 1;

  if (nombre !== undefined) {
    const limpio = String(nombre).trim();
    if (!limpio) {
      return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
    }
    updates.push(`nombre = $${i++}`);
    values.push(limpio);
  }
  if (activo !== undefined) {
    updates.push(`activo = $${i++}`);
    values.push(Boolean(activo));
  }
  if (tipo !== undefined) {
    if (!TIPOS_TIEMPO.includes(tipo)) {
      return res.status(400).json({ message: 'El tipo de máquina debe ser lavadora o secadora.' });
    }
    updates.push(`tipo = $${i++}`);
    values.push(tipo);
  }
  if (tamano !== undefined) {
    if (!TAMANOS_TIEMPO.includes(tamano)) {
      return res.status(400).json({ message: 'El tamaño debe ser mediana o jumbo.' });
    }
    updates.push(`tamano = $${i++}`);
    values.push(tamano);
  }
  // "Varios programas" es parte del modelo. Marcarlo de fichas lo apaga.
  if (pregunta_tiempo !== undefined || solo_fichas) {
    updates.push(`pregunta_tiempo = $${i++}`);
    values.push(Boolean(pregunta_tiempo) && !solo_fichas);
  }
  if (solo_fichas !== undefined) {
    updates.push(`solo_fichas = $${i++}`);
    values.push(Boolean(solo_fichas));
  }
  // "Trabaja con fichas: con Sonoff y con tiempos"; la de sin Sonoff la apaga.
  if (fichas_sonoff !== undefined || solo_fichas) {
    updates.push(`fichas_sonoff = $${i++}`);
    values.push(Boolean(fichas_sonoff) && !solo_fichas);
  }
  // Si el modelo corre dos ciclos por carga.
  if (dos_ciclos !== undefined) {
    updates.push(`dos_ciclos = $${i++}`);
    values.push(Boolean(dos_ciclos));
  }
  // `minutos: null` quita el tiempo propio; distinto de no mandarlo.
  if (minutos !== undefined) {
    const leido = leerMinutos(minutos);
    if (leido.error) return res.status(400).json({ message: leido.error });
    updates.push(`minutos = $${i++}`);
    values.push(leido.valor);
  }
  if (updates.length === 0) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  updates.push('updated_at = NOW()');
  values.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE modelos_maquina SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No se encontró el modelo.' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Esa marca ya tiene un modelo con ese nombre.' });
    }
    console.error('actualizarModeloMaquina error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios del modelo. Intenta de nuevo.' });
  }
};

/** Reordena los modelos de una marca (solo los de esa marca). */
export const reordenarModelosMaquina = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { marca_id: marcaId } = req.body;
  if (!/^\d+$/.test(String(marcaId))) {
    return res.status(400).json({ message: 'Elige una marca válida.' });
  }
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) {
    return res.status(400).json({ message: 'No llegó el nuevo orden de la lista. Intenta de nuevo.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        'UPDATE modelos_maquina SET orden = $1, updated_at = NOW() WHERE id = $2 AND marca_id = $3',
        [i + 1, ids[i], marcaId]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT mo.*, mm.nombre AS marca
         FROM modelos_maquina mo
         JOIN marcas_maquina mm ON mm.id = mo.marca_id
        WHERE mo.marca_id = $1
        ORDER BY mo.orden ASC NULLS LAST, mo.id ASC`,
      [marcaId]
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reordenarModelosMaquina error:', err);
    res.status(500).json({ message: 'No se pudo guardar el nuevo orden de los modelos. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

// ── Tiempos de ciclo ────────────────────────────────────────────────────────
// El tiempo es de la máquina y lo sabe su MODELO ("LG · WM22WV26SR"): es lo que
// se configura. El tiempo por marca sigue en el cálculo como respaldo (ver
// MINUTOS_CONFIGURADOS), pero no se lista.

/** Un renglón por modelo activo (sin los de fichas), aunque ninguna máquina lo use aún. */
export const getTiemposMarca = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mo.marca_id, mm.nombre AS marca,
              mo.id AS modelo_id, mo.nombre AS modelo,
              mo.tipo, mo.tamano,
              mo.minutos, mo.minutos_2, mo.minutos_3, mo.minutos_4, mo.pregunta_tiempo, mo.dos_ciclos,
              mo.minutos_por_ficha, mo.precio_por_ficha, mo.fichas_sonoff,
              mo.precio_programa_2, mo.precio_programa_3, mo.precio_programa_4
         FROM modelos_maquina mo
         JOIN marcas_maquina mm ON mm.id = mo.marca_id
        -- El de fichas no pide tiempos.
        WHERE mo.activo AND mm.activo AND NOT mo.solo_fichas
        ORDER BY mo.tipo, CASE mo.tamano WHEN 'mediana' THEN 0 ELSE 1 END,
                 mm.orden NULLS LAST, mm.id, mo.orden NULLS LAST, mo.id`
    );
    res.json(rows);
  } catch (err) {
    console.error('getTiemposMarca error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los tiempos. Intenta de nuevo.' });
  }
};

/**
 * Guarda (o borra, con vacío) el tiempo de un renglón; borrarlo cae al
 * respaldo en vez de dejar un cero. Con `modelo_id`, en el modelo (lo que usa
 * la pantalla); sin él, el tiempo por marca (respaldo).
 */
export const guardarTiempoMarca = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { marca_id, modelo_id, tipo, tamano, minutos } = req.body;

  if (modelo_id !== undefined && modelo_id !== null) {
    if (!/^\d+$/.test(String(modelo_id))) {
      return res.status(400).json({ message: 'Elige un modelo válido.' });
    }
    // Tiempo (tope), hasta tres programas y, en la secadora de fichas, minutos
    // por ficha. Solo llega lo que cambió.
    const updates = [];
    const values  = [];
    let i = 1;
    for (const [campo, valor] of [
      ['minutos', minutos], ['minutos_2', req.body.minutos_2], ['minutos_3', req.body.minutos_3],
      ['minutos_4', req.body.minutos_4], // `minutos_por_moneda`: alias para tablets con una versión anterior.
      ['minutos_por_ficha', req.body.minutos_por_ficha ?? req.body.minutos_por_moneda],
    ]) {
      if (valor === undefined) continue;
      const leido = leerMinutos(valor);
      if (leido.error) return res.status(400).json({ message: leido.error });
      updates.push(`${campo} = $${i++}`);
      values.push(leido.valor);
    }
    // Pesos (vacío = sin precio): costo de cada ficha y precio de cada programa.
    for (const [campo, mensaje] of [
      ['precio_por_ficha', 'El costo por ficha debe ser un número de 0 en adelante.'],
      ['precio_programa_2', 'El precio de cada tiempo debe ser un número de 0 en adelante.'],
      ['precio_programa_3', 'El precio de cada tiempo debe ser un número de 0 en adelante.'],
      ['precio_programa_4', 'El precio de cada tiempo debe ser un número de 0 en adelante.'],
    ]) {
      const crudo = req.body[campo];
      if (crudo === undefined) continue;
      const precio = crudo === null || crudo === '' ? null : Number(crudo);
      if (precio !== null && (!Number.isFinite(precio) || precio < 0 || precio > 100000)) {
        return res.status(400).json({ message: mensaje });
      }
      updates.push(`${campo} = $${i++}`);
      values.push(precio === null ? null : Math.round(precio * 100) / 100);
    }
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No hay cambios que guardar.' });
    }
    updates.push('updated_at = NOW()');
    values.push(modelo_id);
    try {
      const { rows } = await pool.query(
        `UPDATE modelos_maquina SET ${updates.join(', ')}
          WHERE id = $${i}
          RETURNING id AS modelo_id, marca_id, nombre AS modelo, tipo, tamano,
                    minutos, minutos_2, minutos_3, minutos_4, pregunta_tiempo, minutos_por_ficha, precio_por_ficha,
                    precio_programa_2, precio_programa_3, precio_programa_4`,
        values
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: 'No se encontró el modelo.' });
      }
      return res.json(rows[0]);
    } catch (err) {
      console.error('guardarTiempoMarca (modelo) error:', err);
      return res.status(500).json({ message: 'No se pudo guardar el tiempo. Intenta de nuevo.' });
    }
  }

  if (!/^\d+$/.test(String(marca_id))) {
    return res.status(400).json({ message: 'Elige una marca válida.' });
  }
  if (!TIPOS_TIEMPO.includes(tipo)) {
    return res.status(400).json({ message: 'El tipo de máquina debe ser lavadora o secadora.' });
  }
  if (!TAMANOS_TIEMPO.includes(tamano)) {
    return res.status(400).json({ message: 'El tamaño debe ser mediana o jumbo.' });
  }

  const vacio = minutos === null || minutos === undefined || minutos === '';
  const n = Number(minutos);
  if (!vacio && (!Number.isInteger(n) || n <= 0)) {
    return res.status(400).json({ message: 'El tiempo debe ser un número de minutos mayor que cero.' });
  }

  try {
    if (vacio) {
      await pool.query(
        'DELETE FROM tiempos_marca WHERE marca_id = $1 AND tipo = $2 AND tamano = $3',
        [marca_id, tipo, tamano]
      );
      return res.json({ marca_id: Number(marca_id), tipo, tamano, minutos: null });
    }
    const { rows } = await pool.query(
      `INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (marca_id, tipo, tamano)
       DO UPDATE SET minutos = EXCLUDED.minutos, updated_at = now()
       RETURNING marca_id, tipo, tamano, minutos`,
      [marca_id, tipo, tamano, n]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ message: 'Esa marca ya no existe.' });
    }
    console.error('guardarTiempoMarca error:', err);
    res.status(500).json({ message: 'No se pudo guardar el tiempo. Intenta de nuevo.' });
  }
};
