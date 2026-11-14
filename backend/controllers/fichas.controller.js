// Inventario de fichas (mig. 176).
//   GET   /api/fichas                    resumen de la sucursal activa (todos)
//   GET   /api/fichas/historial          movimientos de un rango de fechas (todos)
//   POST  /api/fichas/recoger            recoge de una máquina o de todas (todos)
//   POST  /api/fichas/ajustar            corrige el conteo de disponibles (admin)
//   GET   /api/fichas/sucursales         qué sucursales usan fichas (admin)
//   PATCH /api/fichas/sucursales/:slug   encender o apagar las fichas y fijar cuántas hay sin tipo (admin)
//   POST  /api/fichas/sucursales/:slug/tipos  dar de alta un tipo de ficha (admin, mig. 179)
//   PATCH /api/fichas/tipos/:id          renombrar un tipo o fijar cuántas hay de él (admin)
//   DELETE /api/fichas/tipos/:id         quitar un tipo sin fichas (admin)
//   PATCH /api/fichas/maquinas/:id       elegir el tipo de ficha de una máquina (admin)

import pool from '../db/pool.js';
import { soloFichasSql } from '../db/sqlMaquina.js';
import { recogerFichas, ajustarFichas } from '../services/fichas.js';

/** Tipos de ficha de la sucursal con sus disponibles y las que están dentro de sus máquinas. */
async function tiposDeFicha(client, sucursal) {
  const { rows } = await client.query(
    `SELECT ft.id, ft.nombre, ft.disponibles,
            COALESCE((SELECT SUM(m.fichas_dentro) FROM maquinas m WHERE m.ficha_tipo_id = ft.id), 0)::int AS dentro
       FROM fichas_tipos ft
      WHERE ft.sucursal = $1
      ORDER BY ft.nombre`,
    [sucursal]
  );
  return rows;
}

/** Máquinas de fichas de la sucursal (o con fichas dentro), con su tipo de ficha. */
async function maquinasDeFichas(client, sucursal) {
  const { rows } = await client.query(
    `SELECT m.id, m.nombre, m.tipo, m.tamano, m.estado, m.fichas_dentro, m.ficha_tipo_id,
            ft.nombre AS ficha_tipo_nombre
       FROM maquinas m
       LEFT JOIN fichas_tipos ft ON ft.id = m.ficha_tipo_id
      WHERE m.sucursal = $1 AND (${soloFichasSql('m')} OR m.fichas_dentro > 0)
      ORDER BY m.tipo, m.nombre`,
    [sucursal]
  );
  return rows;
}

/**
 * Resumen de la sucursal: si usa fichas, sus tipos, las disponibles sin tipo,
 * las de cada máquina y los últimos movimientos.
 */
async function resumenFichas(client, sucursal) {
  const { rows: [suc] } = await client.query(
    'SELECT usa_fichas, fichas_disponibles FROM sucursales WHERE slug = $1', [sucursal]
  );
  const maquinas = await maquinasDeFichas(client, sucursal);
  const tipos = await tiposDeFicha(client, sucursal);
  const { rows: movimientos } = await client.query(
    `SELECT f.id, f.tipo, f.cantidad, f.disponibles_despues, f.maquina_nombre, f.ficha_tipo_nombre, f.created_at,
            n.folio, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario
       FROM fichas_movimientos f
       LEFT JOIN notas n ON n.id = f.nota_id
       LEFT JOIN usuarios u ON u.id = f.usuario_id
      WHERE f.sucursal = $1
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT 30`,
    [sucursal]
  );
  return {
    usa_fichas: Boolean(suc?.usa_fichas),
    disponibles: suc?.fichas_disponibles ?? 0,
    dentro: maquinas.reduce((t, m) => t + m.fichas_dentro, 0),
    tipos,
    maquinas,
    movimientos,
  };
}

export const getFichas = async (req, res) => {
  try {
    res.json(await resumenFichas(pool, req.sucursal));
  } catch (err) {
    console.error('getFichas error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las fichas. Intenta de nuevo.' });
  }
};

/**
 * Historial de movimientos entre `desde` (incluido) y `hasta` (excluido), dos
 * fechas ISO; del más reciente al más viejo, hasta 1,000. Con `años`, los años
 * que tienen movimientos (para el selector de período).
 */
export const getHistorialFichas = async (req, res) => {
  const desde = new Date(String(req.query.desde ?? ''));
  const hasta = new Date(String(req.query.hasta ?? ''));
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || hasta <= desde) {
    return res.status(400).json({ message: 'Elige un rango de fechas válido.' });
  }
  try {
    const [{ rows: movimientos }, { rows: anios }] = await Promise.all([
      pool.query(
        `SELECT f.id, f.tipo, f.cantidad, f.disponibles_despues, f.maquina_nombre, f.ficha_tipo_nombre, f.created_at,
                n.id AS nota_id, n.folio, TRIM(u.nombre || ' ' || COALESCE(u.apellido, '')) AS usuario
           FROM fichas_movimientos f
           LEFT JOIN notas n ON n.id = f.nota_id
           LEFT JOIN usuarios u ON u.id = f.usuario_id
          WHERE f.sucursal = $1 AND f.created_at >= $2 AND f.created_at < $3
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT 1000`,
        [req.sucursal, desde, hasta]
      ),
      pool.query(
        `SELECT DISTINCT EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Mexico_City')::int AS anio
           FROM fichas_movimientos WHERE sucursal = $1 ORDER BY 1 DESC`,
        [req.sucursal]
      ),
    ]);
    res.json({ movimientos, anios: anios.map(r => r.anio) });
  } catch (err) {
    console.error('getHistorialFichas error:', err);
    res.status(500).json({ message: 'No se pudo cargar el historial de fichas. Intenta de nuevo.' });
  }
};

export const recoger = async (req, res) => {
  const maquinaId = req.body?.maquina_id != null ? Number(req.body.maquina_id) : null;
  if (maquinaId != null && !Number.isInteger(maquinaId)) {
    return res.status(400).json({ message: 'Elige una máquina válida.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recogidas = await recogerFichas(client, { sucursal: req.sucursal, maquinaId, usuarioId: req.user.id });
    await client.query('COMMIT');
    res.json({ recogidas, ...(await resumenFichas(pool, req.sucursal)) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('recoger fichas error:', err);
    res.status(500).json({ message: 'No se pudieron recoger las fichas. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

export const ajustar = async (req, res) => {
  const disponibles = Number(req.body?.disponibles);
  if (!Number.isInteger(disponibles) || disponibles < 0 || disponibles > 100000) {
    return res.status(400).json({ message: 'Escribe cuántas fichas hay: un número entero de 0 en adelante.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ajustarFichas(client, { sucursal: req.sucursal, disponibles, usuarioId: req.user.id });
    await client.query('COMMIT');
    res.json(await resumenFichas(pool, req.sucursal));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ajustar fichas error:', err);
    res.status(500).json({ message: 'No se pudo corregir el conteo de fichas. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

/** Renglón de Ajustes → Fichas: la sucursal, sus tipos y sus máquinas de fichas. */
async function filaSucursal(client, s) {
  const [tipos, maquinas] = await Promise.all([tiposDeFicha(client, s.slug), maquinasDeFichas(client, s.slug)]);
  return { ...s, tipos, maquinas };
}

const SQL_SUCURSAL = `SELECT s.slug, s.nombre, s.usa_fichas, s.fichas_disponibles,
        COALESCE((SELECT SUM(m.fichas_dentro) FROM maquinas m
                   WHERE m.sucursal = s.slug AND m.ficha_tipo_id IS NULL), 0)::int AS fichas_dentro
   FROM sucursales s`;

/** Renglón de una sucursal por su slug (tras un cambio). */
async function filaPorSlug(client, slug) {
  const { rows: [s] } = await client.query(`${SQL_SUCURSAL} WHERE s.slug = $1`, [slug]);
  return filaSucursal(client, s);
}

export const getSucursalesFichas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${SQL_SUCURSAL} WHERE s.oculta = FALSE ORDER BY s.activa DESC, s.orden ASC, s.nombre ASC`
    );
    res.json(await Promise.all(rows.map(s => filaSucursal(pool, s))));
  } catch (err) {
    console.error('getSucursalesFichas error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las sucursales. Intenta de nuevo.' });
  }
};

/** Encender o apagar las fichas (`usa_fichas`) y/o fijar cuántas hay sin tipo (`fichas_disponibles`, queda en el historial). */
export const setUsaFichas = async (req, res) => {
  const { usa_fichas, fichas_disponibles } = req.body ?? {};
  if (usa_fichas === undefined && fichas_disponibles === undefined) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  if (usa_fichas !== undefined && typeof usa_fichas !== 'boolean') {
    return res.status(400).json({ message: 'Indica si la sucursal usa fichas.' });
  }
  const total = fichas_disponibles === undefined ? null : Number(fichas_disponibles);
  if (total !== null && (!Number.isInteger(total) || total < 0 || total > 100000)) {
    return res.status(400).json({ message: 'Escribe cuántas fichas hay: un número entero de 0 en adelante.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT slug FROM sucursales WHERE slug = $1 AND oculta = FALSE FOR UPDATE', [req.params.slug]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No se encontró la sucursal.' });
    }
    if (usa_fichas !== undefined) {
      await client.query('UPDATE sucursales SET usa_fichas = $2 WHERE slug = $1', [req.params.slug, usa_fichas]);
    }
    if (total !== null) {
      await ajustarFichas(client, { sucursal: req.params.slug, disponibles: total, usuarioId: req.user.id });
    }
    await client.query('COMMIT');
    res.json(await filaPorSlug(pool, req.params.slug));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('setUsaFichas error:', err);
    res.status(500).json({ message: 'No se pudo guardar. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

/** Nombre de un tipo de ficha: texto de 1 a 60 caracteres, o null si no sirve. */
const leerNombre = (v) => {
  const nombre = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return nombre.length >= 1 && nombre.length <= 60 ? nombre : null;
};

/** Cuántas fichas hay: entero de 0 a 100,000, o null si no sirve. */
const leerTotal = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
};

const NOMBRE_REPETIDO = 'Ya hay un tipo de ficha con ese nombre en esta sucursal.';

/** Corre `fn(client)` en una transacción; los errores con `status` se devuelven tal cual. */
async function enTransaccion(res, mensaje, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slug = await fn(client);
    await client.query('COMMIT');
    res.json(await filaPorSlug(pool, slug));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505') return res.status(409).json({ message: NOMBRE_REPETIDO });
    console.error(`${mensaje}:`, err);
    res.status(500).json({ message: 'No se pudo guardar. Intenta de nuevo.' });
  } finally {
    client.release();
  }
}

/** Error con su código HTTP, para `enTransaccion`. */
const fallo = (status, message) => Object.assign(new Error(message), { status });

export const crearTipo = (req, res) => {
  const nombre = leerNombre(req.body?.nombre);
  if (!nombre) return res.status(400).json({ message: 'Escribe el nombre del tipo de ficha.' });
  return enTransaccion(res, 'crearTipo error', async (client) => {
    const { rows } = await client.query(
      'SELECT slug FROM sucursales WHERE slug = $1 AND oculta = FALSE', [req.params.slug]
    );
    if (rows.length === 0) throw fallo(404, 'No se encontró la sucursal.');
    await client.query('INSERT INTO fichas_tipos (sucursal, nombre) VALUES ($1, $2)', [req.params.slug, nombre]);
    return req.params.slug;
  });
};

/** Renombrar (`nombre`) y/o fijar cuántas hay (`disponibles`, queda en el historial). */
export const editarTipo = (req, res) => {
  const { nombre: nombreBody, disponibles: totalBody } = req.body ?? {};
  if (nombreBody === undefined && totalBody === undefined) {
    return res.status(400).json({ message: 'No hay cambios que guardar.' });
  }
  const nombre = nombreBody === undefined ? null : leerNombre(nombreBody);
  if (nombreBody !== undefined && !nombre) return res.status(400).json({ message: 'Escribe el nombre del tipo de ficha.' });
  const total = totalBody === undefined ? null : leerTotal(totalBody);
  if (totalBody !== undefined && total === null) {
    return res.status(400).json({ message: 'Escribe cuántas fichas hay: un número entero de 0 en adelante.' });
  }
  return enTransaccion(res, 'editarTipo error', async (client) => {
    const { rows: [tipo] } = await client.query(
      `SELECT ft.id, ft.sucursal FROM fichas_tipos ft JOIN sucursales s ON s.slug = ft.sucursal
        WHERE ft.id = $1 AND s.oculta = FALSE FOR UPDATE OF ft`,
      [Number(req.params.id) || 0]
    );
    if (!tipo) throw fallo(404, 'No se encontró el tipo de ficha.');
    if (nombre) await client.query('UPDATE fichas_tipos SET nombre = $2 WHERE id = $1', [tipo.id, nombre]);
    if (total !== null) {
      await ajustarFichas(client, { sucursal: tipo.sucursal, disponibles: total, usuarioId: req.user.id, fichaTipoId: tipo.id });
    }
    return tipo.sucursal;
  });
};

/** Quitar un tipo: sin fichas disponibles ni dentro de sus máquinas; sus máquinas quedan sin tipo. */
export const quitarTipo = (req, res) =>
  enTransaccion(res, 'quitarTipo error', async (client) => {
    const { rows: [tipo] } = await client.query(
      `SELECT ft.id, ft.sucursal, ft.nombre, ft.disponibles,
              COALESCE((SELECT SUM(m.fichas_dentro) FROM maquinas m WHERE m.ficha_tipo_id = ft.id), 0)::int AS dentro
         FROM fichas_tipos ft JOIN sucursales s ON s.slug = ft.sucursal
        WHERE ft.id = $1 AND s.oculta = FALSE FOR UPDATE OF ft`,
      [Number(req.params.id) || 0]
    );
    if (!tipo) throw fallo(404, 'No se encontró el tipo de ficha.');
    if (tipo.dentro > 0) throw fallo(400, `Recoge primero las fichas ${tipo.nombre} que están dentro de las máquinas.`);
    if (tipo.disponibles !== 0) throw fallo(400, `Pon en 0 las fichas ${tipo.nombre} disponibles antes de quitar el tipo.`);
    await client.query('DELETE FROM fichas_tipos WHERE id = $1', [tipo.id]);
    return tipo.sucursal;
  });

/** Tipo de ficha de una máquina (`ficha_tipo_id`, null = sin tipo); con fichas dentro, primero se recogen. */
export const setTipoMaquina = (req, res) => {
  const valor = req.body?.ficha_tipo_id;
  const fichaTipoId = valor == null ? null : Number(valor);
  if (fichaTipoId !== null && !Number.isInteger(fichaTipoId)) {
    return res.status(400).json({ message: 'Elige un tipo de ficha válido.' });
  }
  return enTransaccion(res, 'setTipoMaquina error', async (client) => {
    const { rows: [maq] } = await client.query(
      `SELECT m.id, m.nombre, m.sucursal, m.fichas_dentro, m.ficha_tipo_id
         FROM maquinas m JOIN sucursales s ON s.slug = m.sucursal
        WHERE m.id = $1 AND s.oculta = FALSE FOR UPDATE OF m`,
      [Number(req.params.id) || 0]
    );
    if (!maq) throw fallo(404, 'No se encontró la máquina.');
    if (fichaTipoId !== null) {
      const { rows } = await client.query(
        'SELECT 1 FROM fichas_tipos WHERE id = $1 AND sucursal = $2', [fichaTipoId, maq.sucursal]
      );
      if (rows.length === 0) throw fallo(400, 'Ese tipo de ficha no es de la sucursal de la máquina.');
    }
    if (maq.fichas_dentro > 0 && (maq.ficha_tipo_id ?? null) !== fichaTipoId) {
      throw fallo(400, `Recoge primero las fichas que están dentro de ${maq.nombre}.`);
    }
    await client.query('UPDATE maquinas SET ficha_tipo_id = $2 WHERE id = $1', [maq.id, fichaTipoId]);
    return maq.sucursal;
  });
};
