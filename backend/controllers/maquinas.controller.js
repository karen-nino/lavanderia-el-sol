import pool from '../db/pool.js';

const ESTADOS_VALIDOS = ['disponible', 'en_uso', 'mantenimiento'];
const TIPOS_VALIDOS   = ['lavadora_mediana', 'lavadora_jumbo', 'secadora'];
const CAPACIDADES_VALIDAS = ['20kg', '35kg'];

export const getMaquinas = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM maquinas WHERE sucursal = $1 ORDER BY tipo ASC, nombre ASC',
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getMaquinas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /maquinas/:id/uso ───────────────────────────────────
// Uso diario de la máquina, derivado de las notas que la usaron.
// "Generado" = dinero cobrado (notas PAGADAS), atribuido al día en que se
// usó la máquina. Métricas por día: usos, cargas, generado, empleados que
// la operaron y clientes atendidos. Excluye notas canceladas.
export const getUsoMaquina = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Máquina inválida.' });

  try {
    const { rows: maq } = await pool.query(
      'SELECT id, nombre, tipo, estado, capacidad, sucursal FROM maquinas WHERE id = $1',
      [id]
    );
    if (maq.length === 0) return res.status(404).json({ message: 'Máquina no encontrada.' });

    const { rows: dias } = await pool.query(
      `SELECT
          DATE(n.created_at)                                              AS fecha,
          COUNT(*)::int                                                   AS usos,
          COALESCE(SUM(n.cantidad_cargas), 0)::int                        AS cargas,
          COALESCE(SUM(n.precio_total) FILTER (WHERE n.estado_pago = 'PAGADO'), 0) AS generado,
          COUNT(DISTINCT n.usuario_id)::int                               AS empleados,
          COUNT(DISTINCT n.cliente_id) FILTER (WHERE n.cliente_id IS NOT NULL)::int AS clientes
        FROM notas n
        WHERE n.maquina_id = $1 AND n.estado <> 'CANCELADA'
        GROUP BY DATE(n.created_at)
        ORDER BY fecha DESC`,
      [id]
    );

    const diasFmt = dias.map((d) => ({
      fecha:     d.fecha,
      usos:      d.usos,
      cargas:    d.cargas,
      generado:  parseFloat(d.generado),
      empleados: d.empleados,
      clientes:  d.clientes,
    }));

    const resumen = diasFmt.reduce(
      (acc, d) => ({
        dias_usada: acc.dias_usada + 1,
        usos:       acc.usos + d.usos,
        cargas:     acc.cargas + d.cargas,
        generado:   acc.generado + d.generado,
      }),
      { dias_usada: 0, usos: 0, cargas: 0, generado: 0 }
    );

    res.json({ maquina: maq[0], resumen, dias: diasFmt });
  } catch (err) {
    console.error('getUsoMaquina error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createMaquina = async (req, res) => {
  const { nombre, tipo, modelo, capacidad, numero_serie, fecha_adquisicion, notas } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Capacidad inválida. Valores permitidos: ${CAPACIDADES_VALIDAS.join(', ')}.` });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO maquinas (nombre, tipo, modelo, capacidad, numero_serie, fecha_adquisicion, sucursal, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [nombre, tipo, modelo, capacidad, numero_serie, fecha_adquisicion, req.sucursal, notas]
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
  const { nombre, tipo, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado } = req.body;

  if (!nombre || !tipo) {
    return res.status(400).json({ message: 'Nombre y tipo son requeridos.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ message: `Tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  if (capacidad != null && !CAPACIDADES_VALIDAS.includes(capacidad)) {
    return res.status(400).json({ message: `Capacidad inválida. Valores permitidos: ${CAPACIDADES_VALIDAS.join(', ')}.` });
  }
  if (estado != null && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ message: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.` });
  }

  try {
    // estado es opcional: si llega null se conserva el actual. Al cambiarlo se
    // mantiene en_uso_desde coherente, igual que en cambiarEstadoMaquina.
    const { rows } = await pool.query(
      `UPDATE maquinas
         SET nombre = $1, tipo = $2, modelo = $3, capacidad = $4, numero_serie = $5, fecha_adquisicion = $6, notas = $7,
             estado = COALESCE($8::estado_maquina, estado),
             en_uso_desde = CASE
               WHEN $8::estado_maquina IS NULL THEN en_uso_desde
               WHEN $8::estado_maquina = 'en_uso'::estado_maquina THEN NOW()
               ELSE NULL
             END
       WHERE id = $9
       RETURNING *`,
      [nombre, tipo, modelo, capacidad, numero_serie, fecha_adquisicion, notas, estado ?? null, id]
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
