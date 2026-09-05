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
