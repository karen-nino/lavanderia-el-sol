import pool from '../db/pool.js';
import { esAdmin } from '../middleware/roles.js';

// Catálogos de etiquetas internas para encargos (tipos de tela, tamaños de
// edredón). Son listas simples que el admin gestiona en Ajustes. Comparten
// exactamente la misma forma (nombre + activo), así que se generan con esta
// fábrica para no duplicar la lógica CRUD.
function crearControladorEtiqueta(tabla) {
  const getAll = async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM ${tabla} ORDER BY activo DESC, nombre ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error(`get ${tabla} error:`, err);
      res.status(500).json({ message: 'Error interno del servidor.' });
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
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (nombre) VALUES ($1) RETURNING *`,
        [nombre]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'Ya existe una etiqueta con ese nombre.' });
      }
      console.error(`create ${tabla} error:`, err);
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  };

  const update = async (req, res) => {
    if (!esAdmin(req.user.rol)) {
      return res.status(403).json({ message: 'Solo un administrador puede realizar esta acción.' });
    }
    const { id } = req.params;
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
      return res.status(400).json({ message: 'No hay campos para actualizar.' });
    }
    updates.push('updated_at = NOW()');
    values.push(id);

    try {
      const { rows } = await pool.query(
        `UPDATE ${tabla} SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
        values
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Etiqueta no encontrada.' });
      }
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ message: 'Ya existe una etiqueta con ese nombre.' });
      }
      console.error(`update ${tabla} error:`, err);
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  };

  return { getAll, create, update };
}

export const tiposTela      = crearControladorEtiqueta('tipos_tela');
export const tamanosEdredon = crearControladorEtiqueta('tamanos_edredon');
