import pool from '../db/pool.js';

/** Teléfono obligatorio y solo dígitos. Devuelve el mensaje de error o null. */
const validarTelefono = (telefono) => {
  const t = String(telefono ?? '').trim();
  if (!t) return 'El teléfono es requerido.';
  if (!/^\d+$/.test(t)) return 'El teléfono solo puede contener números.';
  return null;
};

export const getClientes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      // notas_count: cuántas notas tiene en la sucursal (columna Notas de escritorio).
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM notas n WHERE n.cliente_id = c.id AND n.sucursal = $1) AS notas_count
         FROM clientes c
        WHERE c.activo = TRUE AND c.sucursal = $1
        ORDER BY c.nombre ASC`,
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getClientes error:', err);
    res.status(500).json({ message: 'No se pudieron cargar los clientes. Intenta de nuevo.' });
  }
};

export const getClienteById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM clientes WHERE id = $1 AND activo = TRUE AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('getClienteById error:', err);
    res.status(500).json({ message: 'No se pudo cargar el cliente. Intenta de nuevo.' });
  }
};

export const createCliente = async (req, res) => {
  const { nombre, apellido, telefono, notas } = req.body;

  if (!nombre) {
    return res.status(400).json({ message: 'El nombre es requerido.' });
  }

  // Solo nombre y teléfono son obligatorios.
  const apellidoLimpio = String(apellido ?? '').trim() || null;

  const errorTelefono = validarTelefono(telefono);
  if (errorTelefono) {
    return res.status(400).json({ message: errorTelefono });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, apellido, telefono, notas, sucursal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, apellidoLimpio, telefono, notas, req.sucursal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createCliente error:', err);
    res.status(500).json({ message: 'No se pudo crear el cliente. Intenta de nuevo.' });
  }
};

export const deleteCliente = async (req, res) => {
  const { id } = req.params;

  try {
    // Primero la sucursal, para no revelar clientes de otras.
    const { rows: cli } = await pool.query(
      'SELECT id FROM clientes WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (cli.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }

    // Con notas activas no se borra.
    const { rows: activas } = await pool.query(
      `SELECT id FROM notas
       WHERE cliente_id = $1
         AND estado NOT IN ('CANCELADA', 'FINALIZADA')`,
      [id]
    );
    if (activas.length > 0) {
      return res.status(400).json({ message: 'No se puede eliminar un cliente con notas activas.' });
    }

    // Con notas cerradas se oculta (activo = FALSE; la FK no deja borrarlo) y
    // sus notas conservan el nombre. Sin notas, se borra.
    const { rows } = await pool.query(
      `WITH conHistorial AS (SELECT EXISTS (SELECT 1 FROM notas WHERE cliente_id = $1) AS si),
            ocultado AS (
              UPDATE clientes SET activo = FALSE
               WHERE id = $1 AND sucursal = $2 AND (SELECT si FROM conHistorial)
               RETURNING id
            ),
            borrado AS (
              DELETE FROM clientes
               WHERE id = $1 AND sucursal = $2 AND NOT (SELECT si FROM conHistorial)
               RETURNING id
            )
       SELECT id FROM ocultado UNION ALL SELECT id FROM borrado`,
      [id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json({ message: 'Cliente eliminado.' });
  } catch (err) {
    console.error('deleteCliente error:', err);
    res.status(500).json({ message: 'No se pudo eliminar el cliente. Intenta de nuevo.' });
  }
};

/**
 * Borrado múltiple (admin), en la sucursal. `confirmar: false` solo verifica:
 * devuelve los bloqueados (con notas activas) y los eliminables para el modal.
 * `confirmar: true` borra (u oculta) los eliminables en una transacción.
 */
export const deleteClientesMultiples = async (req, res) => {
  const { ids, confirmar } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'No se recibieron clientes a eliminar.' });
  }
  const idsNum = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (idsNum.length === 0) {
    return res.status(400).json({ message: 'No se entendió la lista de clientes a eliminar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ids de otra sucursal se ignoran.
    const { rows: clientes } = await client.query(
      'SELECT id, nombre, apellido FROM clientes WHERE id = ANY($1) AND sucursal = $2 FOR UPDATE',
      [idsNum, req.sucursal]
    );
    const idsValidos = clientes.map((c) => c.id);

    // Con notas activas: bloqueados.
    let bloqueadosSet = new Set();
    if (idsValidos.length > 0) {
      const { rows: activas } = await client.query(
        `SELECT DISTINCT cliente_id FROM notas
          WHERE cliente_id = ANY($1)
            AND estado NOT IN ('CANCELADA', 'FINALIZADA')`,
        [idsValidos]
      );
      bloqueadosSet = new Set(activas.map((r) => r.cliente_id));
    }

    const bloqueados  = clientes.filter((c) => bloqueadosSet.has(c.id));
    const eliminables = clientes.filter((c) => !bloqueadosSet.has(c.id));

    // Modo verificación: no se borra nada.
    if (!confirmar) {
      await client.query('ROLLBACK');
      return res.json({ bloqueados, eliminables: eliminables.map((c) => c.id) });
    }

    // Con notas cerradas se ocultan (ver deleteCliente).
    let eliminados = [];
    if (eliminables.length > 0) {
      const ids = eliminables.map((c) => c.id);
      const { rows: ocultados } = await client.query(
        `UPDATE clientes SET activo = FALSE
          WHERE id = ANY($1) AND sucursal = $2
            AND EXISTS (SELECT 1 FROM notas WHERE cliente_id = clientes.id)
          RETURNING id`,
        [ids, req.sucursal]
      );
      const { rows: borrados } = await client.query(
        `DELETE FROM clientes
          WHERE id = ANY($1) AND sucursal = $2
            AND NOT EXISTS (SELECT 1 FROM notas WHERE cliente_id = clientes.id)
          RETURNING id`,
        [ids, req.sucursal]
      );
      eliminados = [...ocultados, ...borrados].map((r) => r.id).sort((a, b) => a - b);
    }
    await client.query('COMMIT');
    res.json({ eliminados, bloqueados });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('deleteClientesMultiples error:', err);
    res.status(500).json({ message: 'No se pudieron eliminar los clientes. Intenta de nuevo.' });
  } finally {
    client.release();
  }
};

export const updateCliente = async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, telefono, notas, activo } = req.body;

  // Si llega teléfono, debe ser válido.
  if (telefono !== undefined && telefono !== null) {
    const errorTelefono = validarTelefono(telefono);
    if (errorTelefono) {
      return res.status(400).json({ message: errorTelefono });
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE clientes
       SET nombre   = COALESCE($1, nombre),
           apellido = COALESCE($2, apellido),
           telefono = COALESCE($3, telefono),
           notas    = COALESCE($4, notas),
           activo   = COALESCE($5, activo)
       WHERE id = $6 AND sucursal = $7
       RETURNING *`,
      [nombre, apellido, telefono, notas, activo, id, req.sucursal]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Cliente no encontrado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('updateCliente error:', err);
    res.status(500).json({ message: 'No se pudieron guardar los cambios del cliente. Intenta de nuevo.' });
  }
};
