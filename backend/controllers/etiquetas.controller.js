import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Catálogos de etiquetas internas para encargos (tipos de tela, tamaños de
// edredón). Son listas simples que el admin gestiona en Ajustes. Comparten
// exactamente la misma forma (nombre + activo), así que se generan con esta
// fábrica para no duplicar la lógica CRUD.
//
// `nombres` son las palabras con las que el usuario conoce el catálogo, para
// que los mensajes hablen de "el tipo de tela" y no del nombre de la tabla.
// `banderas` son columnas BOOLEAN propias de ese catálogo que se guardan junto
// al nombre (mig. 122: `arranca_sola` de la marca de máquina).
// Se listan aquí y no se leen del body a lo que venga: los nombres entran en el
// SQL, así que solo pueden ser los que el catálogo declara.
function crearControladorEtiqueta(tabla, nombres, banderas = []) {
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
    try {
      // Se agrega al final del orden actual. Las banderas que declare el
      // catálogo entran con su valor del body (false si no viene).
      const cols = banderas.map((b, k) => `, ${b}`).join('');
      const vals = banderas.map((b, k) => `, $${k + 2}`).join('');
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (nombre, orden${cols})
         VALUES ($1, (SELECT COALESCE(MAX(orden), 0) + 1 FROM ${tabla})${vals})
         RETURNING *`,
        [nombre, ...banderas.map(b => Boolean(req.body[b]))]
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
    // Un id que no es un número no puede existir: sin este corte entra a la
    // consulta y Postgres responde con un 500 en vez de un "no se encontró".
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
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No hay cambios que guardar.' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    try {
      const { rows } = await pool.query(
        `UPDATE ${tabla} SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: `No se encontró ${nombres.singular}.` });
      }
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: `Ya existe ${nombres.uno} con ese nombre.` });
      }
      console.error(`update ${tabla} error:`, err);
      res.status(500).json({ message: `No se pudieron guardar los cambios de ${nombres.singular}. Intenta de nuevo.` });
    }
  };

  // Reordena todo el catálogo: recibe { ids: [...] } en el nuevo orden y asigna
  // orden = posición. En una transacción para que quede consistente.
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
export const tamanosEdredon = crearControladorEtiqueta('tamanos_edredon', {
  singular: 'el tamaño de edredón', plural: 'los tamaños de edredón', uno: 'un tamaño de edredón',
});
export const marcasProducto = crearControladorEtiqueta('marcas_producto', {
  singular: 'la marca', plural: 'las marcas', uno: 'una marca',
});
export const envasesProducto = crearControladorEtiqueta('envases_producto', {
  singular: 'el envase', plural: 'los envases', uno: 'un envase',
});
// La marca de máquina declara además si sus aparatos **arrancan solos** al
// recibir corriente (mig. 122): entonces Salidas ofrece "Iniciar" en un paso,
// sin encender antes. Los dos ciclos por carga los declara el MODELO (mig. 123).
export const marcasMaquina = crearControladorEtiqueta('marcas_maquina', {
  singular: 'la marca', plural: 'las marcas', uno: 'una marca',
}, ['arranca_sola']);
// Los líquidos que se venden a granel (mig. 119): es el nombre del producto
// cuando se rellena desde un bidón ("Jabón", "Suavizante").
export const granelesProducto = crearControladorEtiqueta('graneles_producto', {
  singular: 'el granel', plural: 'los graneles', uno: 'un granel',
});
// Tamaños de bolsa (mig. 119). Conviene que coincidan con los tamaños de carga:
// la bolsa se cobra en la nota comparando su tamaño con el de la carga.
export const tamanosBolsa = crearControladorEtiqueta('tamanos_bolsa', {
  singular: 'el tamaño de bolsa', plural: 'los tamaños de bolsa', uno: 'un tamaño de bolsa',
});

// Los dos ejes de una máquina, cerrados: los comparten el catálogo de modelos
// (mig. 118) y los tiempos por marca (mig. 107).
const TIPOS_TIEMPO = ['lavadora', 'secadora'];
const TAMANOS_TIEMPO = ['mediana', 'jumbo'];

// ── Modelos de máquina (migs. 117 y 118) ────────────────────────────────────
//
// Los modelos cuelgan de una marca, así que no encajan en la fábrica de
// arriba: toda consulta se filtra por `marca_id`. El resto se comporta igual
// que cualquier catálogo (crear, renombrar, activar/desactivar, reordenar;
// solo admin).
//
// Un modelo dice qué máquina es —tipo y tamaño (mig. 118)—, que es lo que lo
// coloca en su bloque de Ajustes. Su tiempo de ciclo (`minutos`) NO se captura
// aquí: se escribe desde ese bloque, junto a los demás tiempos.

// Normaliza los minutos que llegan del formulario: vacío es un modelo sin
// tiempo propio —cae al respaldo por marca—, y cualquier otra cosa tiene que
// ser un entero positivo. Devuelve { valor } o { error }.
function leerMinutos(minutos) {
  if (minutos === null || minutos === undefined || minutos === '') return { valor: null };
  const n = Number(minutos);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: 'El tiempo debe ser un número de minutos mayor que cero.' };
  }
  return { valor: n };
}

// Todos los modelos, o los de una marca si viene `?marca_id=`. Vienen con el
// nombre de su marca porque la máquina guarda el NOMBRE y no el id (mig. 106):
// quien arma el desplegable compara por nombre.
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
  const { tipo, tamano, pregunta_tiempo, dos_ciclos } = req.body;
  if (!TIPOS_TIEMPO.includes(tipo)) {
    return res.status(400).json({ message: 'El tipo de máquina debe ser lavadora o secadora.' });
  }
  if (!TAMANOS_TIEMPO.includes(tamano)) {
    return res.status(400).json({ message: 'El tamaño debe ser mediana o jumbo.' });
  }
  const minutos = leerMinutos(req.body.minutos);
  if (minutos.error) return res.status(400).json({ message: minutos.error });

  try {
    // El orden se cuenta dentro de la marca: cada marca tiene su propia lista.
    const { rows } = await pool.query(
      `INSERT INTO modelos_maquina (marca_id, nombre, tipo, tamano, minutos, pregunta_tiempo, dos_ciclos, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT COALESCE(MAX(orden), 0) + 1 FROM modelos_maquina WHERE marca_id = $1))
       RETURNING *`,
      [marcaId, nombre, tipo, tamano, minutos.valor, Boolean(pregunta_tiempo), Boolean(dos_ciclos)]
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
  const { nombre, activo, tipo, tamano, minutos, pregunta_tiempo, dos_ciclos } = req.body;

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
  // Que el modelo tenga varios tiempos y pregunte cuál usar es parte de lo que
  // ES el modelo (mig. 120), igual que su tipo: se declara aquí, y el bloque de
  // tiempos enseña los campos extra solo a los modelos que lo tienen.
  if (pregunta_tiempo !== undefined) {
    updates.push(`pregunta_tiempo = $${i++}`);
    values.push(Boolean(pregunta_tiempo));
  }
  // Mig. 123: la segunda vuelta de la carga se declara en el modelo.
  if (dos_ciclos !== undefined) {
    updates.push(`dos_ciclos = $${i++}`);
    values.push(Boolean(dos_ciclos));
  }
  // `minutos: null` es un cambio de verdad —quitarle el tiempo propio al
  // modelo—, así que se distingue de no mandar el campo.
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

// Reordena los modelos de UNA marca: llegan sus ids en el nuevo orden. El
// filtro por `marca_id` evita que una lista mal armada renumere los modelos de
// otra marca.
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

// ── Tiempos de ciclo por modelo (migs. 107 y 118) ───────────────────────────
//
// La duración de un ciclo es de la MÁQUINA y no de la carga: una LG mediana
// tarda 45 min y una Speed Queen jumbo 35, al revés de lo que suponía el eje
// del tamaño. Quien lo sabe de verdad es el MODELO, así que es lo único que
// se configura: "LG · WM22WV26SR".
//
// El escalón por MARCA de la mig. 107 sigue existiendo en la base y en el
// cálculo (ver MINUTOS_CONFIGURADOS), pero ya no se lista: es el respaldo de
// las máquinas que todavía no tienen modelo capturado, no algo que se
// configure. Cuando todas lo tengan, deja de usarse solo.

// Un renglón por modelo activo. El modelo dice su tipo y su tamaño (mig. 118),
// así que aparece en su bloque aunque todavía no haya ninguna máquina con ese
// modelo: primero se configura el tiempo, luego se le asigna a las máquinas.
export const getTiemposMarca = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mo.marca_id, mm.nombre AS marca,
              mo.id AS modelo_id, mo.nombre AS modelo,
              mo.tipo, mo.tamano,
              mo.minutos, mo.minutos_2, mo.minutos_3, mo.pregunta_tiempo, mo.dos_ciclos
         FROM modelos_maquina mo
         JOIN marcas_maquina mm ON mm.id = mo.marca_id
        WHERE mo.activo AND mm.activo
        ORDER BY mo.tipo, CASE mo.tamano WHEN 'mediana' THEN 0 ELSE 1 END,
                 mm.orden NULLS LAST, mm.id, mo.orden NULLS LAST, mo.id`
    );
    res.json(rows);
  } catch (err) {
    console.error('getTiemposMarca error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los tiempos. Intenta de nuevo.' });
  }
};

// Guarda (o borra) el tiempo de UN renglón. `minutos` vacío o nulo lo borra:
// ese renglón vuelve a usar el escalón de abajo —la marca, o el tamaño de
// Ajustes—, que es la forma de deshacer sin dejar un cero que pararía el
// temporizador.
//
// Con `modelo_id` el tiempo es del modelo y vive en su fila del catálogo
// (mig. 118): es el único que se configura desde la pantalla.
//
// Sin él escribe el tiempo por marca (mig. 107), que ya no se lista pero
// sigue aplicándose a las máquinas sin modelo. Se conserva porque es la única
// forma de corregir uno de esos tiempos heredados mientras queden máquinas
// así; el día que todas tengan modelo, sobra.
export const guardarTiempoMarca = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { marca_id, modelo_id, tipo, tamano, minutos } = req.body;

  if (modelo_id !== undefined && modelo_id !== null) {
    if (!/^\d+$/.test(String(modelo_id))) {
      return res.status(400).json({ message: 'Elige un modelo válido.' });
    }
    // Un modelo puede llevar hasta tres tiempos y un interruptor (mig. 120).
    // Se manda solo lo que cambió, así que cada campo se mira por separado.
    const updates = [];
    const values  = [];
    let i = 1;
    for (const [campo, valor] of [
      ['minutos', minutos], ['minutos_2', req.body.minutos_2], ['minutos_3', req.body.minutos_3],
    ]) {
      if (valor === undefined) continue;
      const leido = leerMinutos(valor);
      if (leido.error) return res.status(400).json({ message: leido.error });
      updates.push(`${campo} = $${i++}`);
      values.push(leido.valor);
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
                    minutos, minutos_2, minutos_3, pregunta_tiempo`,
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
