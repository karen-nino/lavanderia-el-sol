import pool from '../db/pool.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];

export const getMaquinas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maquinas ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, modelo, numero_serie, fecha_adquisicion, notas } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, modelo, numero_serie, fecha_adquisicion, notas)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nombre, tipo, modelo, numero_serie, fecha_adquisicion, notas]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createMaquina error:', err);
    if (err.code === '22P02') {
      return res.status(400).json({ message: 'Tipo de máquina inválido.' });
    }
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const cambiarEstadoMaquina = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE maquinas SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('cambiarEstadoMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
