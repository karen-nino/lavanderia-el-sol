// Inventario de fichas (mig. 176).
//   GET   /api/fichas                    resumen de la sucursal activa (todos)
//   POST  /api/fichas/recoger            recoge de una máquina o de todas (todos)
//   POST  /api/fichas/ajustar            corrige el conteo de disponibles (admin)
//   GET   /api/fichas/sucursales         qué sucursales usan fichas (admin)
//   PATCH /api/fichas/sucursales/:slug   encender o apagar las fichas y fijar cuántas hay (admin)

import pool from '../db/pool.js';
import { soloFichasSql } from '../db/sqlMaquina.js';
import { recogerFichas, ajustarFichas } from '../services/fichas.js';

/** Resumen de la sucursal: si usa fichas, las disponibles, las de cada máquina y los últimos movimientos. */
async function resumenFichas(client, sucursal) {
  const { rows: [suc] } = await client.query(
    'SELECT usa_fichas, fichas_disponibles FROM sucursales WHERE slug = $1', [sucursal]
  );
  const { rows: maquinas } = await client.query(
    `SELECT m.id, m.nombre, m.tipo, m.tamano, m.estado, m.fichas_dentro
       FROM maquinas m
      WHERE m.sucursal = $1 AND (${soloFichasSql('m')} OR m.fichas_dentro > 0)
      ORDER BY m.tipo, m.nombre`,
    [sucursal]
  );
  const { rows: movimientos } = await client.query(
    `SELECT f.id, f.tipo, f.cantidad, f.disponibles_despues, f.maquina_nombre, f.created_at,
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

export const getSucursalesFichas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.slug, s.nombre, s.usa_fichas, s.fichas_disponibles,
            COALESCE((SELECT SUM(m.fichas_dentro) FROM maquinas m WHERE m.sucursal = s.slug), 0)::int AS fichas_dentro
       FROM sucursales s
      WHERE s.oculta = FALSE ORDER BY s.activa DESC, s.orden ASC, s.nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('getSucursalesFichas error:', err);
    res.status(500).json({ message: 'No se pudieron cargar las sucursales. Intenta de nuevo.' });
  }
};

/** Encender o apagar las fichas (`usa_fichas`) y/o fijar cuántas hay (`fichas_disponibles`, queda en el historial). */
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
    const { rows: [fila] } = await pool.query(
      `SELECT s.slug, s.nombre, s.usa_fichas, s.fichas_disponibles,
              COALESCE((SELECT SUM(m.fichas_dentro) FROM maquinas m WHERE m.sucursal = s.slug), 0)::int AS fichas_dentro
         FROM sucursales s WHERE s.slug = $1`,
      [req.params.slug]
    );
    res.json(fila);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('setUsaFichas error:', err);
    res.status(500).json({ message: 'No se pudo guardar. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};
