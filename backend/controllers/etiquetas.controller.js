import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Catálogos de etiquetas internas para encargos (tipos de tela, tamaños de
// edredón). Son listas simples que el admin gestiona en Ajustes. Comparten
// exactamente la misma forma (nombre + activo), así que se generan con esta
// fábrica para no duplicar la lógica CRUD.
//
// `nombres` son las palabras con las que el usuario conoce el catálogo, para
// que los mensajes hablen de "el tipo de tela" y no del nombre de la tabla.
function crearControladorEtiqueta(tabla, nombres) {
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
      // Se agrega al final del orden actual.
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (nombre, orden)
         VALUES ($1, (SELECT COALESCE(MAX(orden), 0) + 1 FROM ${tabla}))
         RETURNING *`,
        [nombre]
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
export const marcasMaquina = crearControladorEtiqueta('marcas_maquina', {
  singular: 'la marca', plural: 'las marcas', uno: 'una marca',
});

// ── Tiempos de ciclo por marca y tamaño (mig. 107) ──────────────────────────
//
// La duración de un ciclo es de la MÁQUINA y no de la carga: una LG mediana
// tarda 45 min y una Speed Queen jumbo 35, al revés de lo que suponía el eje
// del tamaño. Aquí se configuran esas combinaciones; lo que no esté aquí cae
// al tiempo por tamaño de Ajustes, que sigue existiendo como respaldo.

const TIPOS_TIEMPO = ['lavadora', 'secadora'];
const TAMANOS_TIEMPO = ['mediana', 'jumbo'];

// Devuelve una fila por combinación marca+tipo+tamaño que tenga sentido
// mostrar: las que existen en máquinas dadas de alta, más las que ya tengan un
// tiempo configurado. Así la pantalla enseña la lavandería real y no una
// matriz llena de campos vacíos (no hay ninguna LG jumbo, así que ese renglón
// no aparece hasta que exista la máquina).
export const getTiemposMarca = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH combos AS (
         SELECT DISTINCT mm.id AS marca_id,
                CASE WHEN m.tipo = 'secadora' THEN 'secadora' ELSE 'lavadora' END AS tipo,
                m.tamano
           FROM maquinas m
           JOIN marcas_maquina mm ON mm.nombre = m.marca
          WHERE m.tamano IS NOT NULL
         UNION
         SELECT tm.marca_id, tm.tipo, tm.tamano FROM tiempos_marca tm
       )
       SELECT c.marca_id, mm.nombre AS marca, c.tipo, c.tamano, tm.minutos
         FROM combos c
         JOIN marcas_maquina mm ON mm.id = c.marca_id
         LEFT JOIN tiempos_marca tm
                ON tm.marca_id = c.marca_id AND tm.tipo = c.tipo AND tm.tamano = c.tamano
        WHERE mm.activo
        ORDER BY c.tipo, CASE c.tamano WHEN 'mediana' THEN 0 ELSE 1 END, mm.orden NULLS LAST, mm.id`
    );
    res.json(rows);
  } catch (err) {
    console.error('getTiemposMarca error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los tiempos por marca. Intenta de nuevo.' });
  }
};

// Guarda (o borra) el tiempo de UNA combinación. `minutos` vacío o nulo borra
// la fila: esa combinación vuelve a usar el tiempo por tamaño de Ajustes, que
// es la forma de deshacer sin dejar un cero que pararía el temporizador.
export const guardarTiempoMarca = async (req, res) => {
  if (!esAdmin(req.user.rol)) {
    return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
  }
  const { marca_id, tipo, tamano, minutos } = req.body;

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
