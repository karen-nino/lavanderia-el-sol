import pool from '../db/pool.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];

export const getMaquinas = async (req, res) => {
  try {
    const { sucursal } = req.query;
    const query = sucursal
      ? 'SELECT * FROM maquinas WHERE sucursal = $1 ORDER BY tipo ASC, nombre ASC'
      : 'SELECT * FROM maquinas ORDER BY tipo ASC, nombre ASC';
    const { rows } = await pool.query(query, sucursal ? [sucursal] : []);
    res.json(rows);
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, modelo, numero_serie, fecha_adquisicion, sucursal = 'lopez_cotilla', notas } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, modelo, numero_serie, fecha_adquisicion, sucursal, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [nombre, tipo, modelo, numero_serie, fecha_adquisicion, sucursal, notas]
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

export const updateMaquina = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, modelo, numero_serie, fecha_adquisicion, notas } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET nombre = $1, tipo = $2, modelo = $3, numero_serie = $4, fecha_adquisicion = $5, notas = $6
       WHERE id = $7
       RETURNING *`,
      [nombre, tipo, modelo, numero_serie, fecha_adquisicion, notas, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteMaquina = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM maquinas WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Máquina no encontrada.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('deleteMaquina error:', err);
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
    // en_uso_desde se setea al activar y se limpia al salir de en_uso.
    // Se castea $1 al enum estado_maquina porque al usarlo en la rama CASE
    // Postgres ya no puede inferir el tipo desde la asignación a la columna.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET estado       = $1::estado_maquina,
             en_uso_desde = CASE
               WHEN $1::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END
       WHERE id = $2
       RETURNING *`,
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
