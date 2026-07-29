import pool from '../db/pool.js';
import bcrypt from 'bcrypt';

const ROL_VALIDOS = ['admin_main', 'admin', 'operador'];

export const getEmpleados = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, rol, sucursal, activo, created_at
         FROM usuarios
        WHERE activo = TRUE AND sucursal = $1
        ORDER BY nombre ASC`,
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getEmpleados error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── GET /usuarios/:id/desempeno ─────────────────────────────
// Desempeño diario del empleado, derivado de las notas que creó.
// "Vendido" = valor (precio_total) de todas sus notas no canceladas,
// atribuido al día en que se crearon. Métricas por día: notas, vendido,
// máquinas distintas, cargas, productos despachados y clientes (cada
// autoservicio cuenta como 1 cliente; el resto, sus clientes distintos).
export const getDesempeno = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Empleado inválido.' });

  try {
    const { rows: emp } = await pool.query(
      'SELECT id, nombre, rol, sucursal FROM usuarios WHERE id = $1',
      [id]
    );
    if (emp.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });

    // Se pre-agregan los productos y las máquinas por día para no multiplicar
    // los demás totales al unirlos. Las máquinas de una nota pueden venir de sus
    // cargas (autoservicio, nota_cargas) o de las columnas legadas
    // maquina_id / secadora_id (Por Encargo y notas viejas). En cada carga se
    // cuentan tanto la máquina activa (lavadora_id/secadora_id) como la que ya
    // se usó y se desvinculó al terminar (lavadora_usada_id/secadora_usada_id),
    // para no perder las notas ya terminadas.
    const { rows: dias } = await pool.query(
      `WITH base AS (
          SELECT n.id, DATE(n.created_at) AS fecha, n.precio_total,
                 n.cantidad_cargas, n.cliente_id, n.modalidad,
                 n.maquina_id, n.secadora_id
            FROM notas n
           WHERE n.usuario_id = $1 AND n.estado <> 'CANCELADA'
        ),
        maq AS (
          SELECT b.fecha, COUNT(DISTINCT ids.mid)::int AS maquinas
            FROM base b
            CROSS JOIN LATERAL (
              SELECT b.maquina_id  AS mid
              UNION ALL SELECT b.secadora_id
              UNION ALL SELECT nc.lavadora_id       FROM nota_cargas nc WHERE nc.nota_id = b.id
              UNION ALL SELECT nc.secadora_id       FROM nota_cargas nc WHERE nc.nota_id = b.id
              UNION ALL SELECT nc.lavadora_usada_id FROM nota_cargas nc WHERE nc.nota_id = b.id
              UNION ALL SELECT nc.secadora_usada_id FROM nota_cargas nc WHERE nc.nota_id = b.id
            ) ids
           WHERE ids.mid IS NOT NULL
           GROUP BY b.fecha
        )
        SELECT
          b.fecha                                                         AS fecha,
          COUNT(*)::int                                                   AS notas,
          COALESCE(SUM(b.precio_total), 0)                                AS vendido,
          COALESCE(MAX(maq.maquinas), 0)::int                             AS maquinas,
          COALESCE(SUM(b.cantidad_cargas), 0)::int                        AS cargas,
          COALESCE(SUM(np.qty), 0)::int                                   AS productos,
          -- Clientes: cada nota de autoservicio cuenta como 1 cliente (no lleva
          -- cliente registrado); las demás suman sus clientes distintos.
          (
            COUNT(*) FILTER (WHERE b.modalidad = 'AUTOSERVICIO')
            + COUNT(DISTINCT b.cliente_id) FILTER (WHERE b.cliente_id IS NOT NULL)
          )::int                                                          AS clientes
        FROM base b
        LEFT JOIN (
          SELECT nota_id, SUM(cantidad) AS qty
          FROM nota_productos
          GROUP BY nota_id
        ) np ON np.nota_id = b.id
        LEFT JOIN maq ON maq.fecha = b.fecha
        GROUP BY b.fecha
        ORDER BY b.fecha DESC`,
      [id]
    );

    const diasFmt = dias.map((d) => ({
      fecha:     d.fecha,
      notas:     d.notas,
      vendido:   parseFloat(d.vendido),
      maquinas:  d.maquinas,
      cargas:    d.cargas,
      productos: d.productos,
      clientes:  d.clientes,
    }));

    const resumen = diasFmt.reduce(
      (acc, d) => ({
        dias_activos: acc.dias_activos + 1,
        notas:        acc.notas + d.notas,
        vendido:      acc.vendido + d.vendido,
        cargas:       acc.cargas + d.cargas,
        productos:    acc.productos + d.productos,
      }),
      { dias_activos: 0, notas: 0, vendido: 0, cargas: 0, productos: 0 }
    );

    res.json({ empleado: emp[0], resumen, dias: diasFmt });
  } catch (err) {
    console.error('getDesempeno error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const createEmpleado = async (req, res) => {
  const { nombre, password, rol, sucursal } = req.body;

  if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  const rolFinal = ROL_VALIDOS.includes(rol) ? rol : 'operador';

  if (rolFinal === 'admin_main' && req.user.rol !== 'admin_main') {
    return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
  }

  // El admin elige la sucursal del empleado en el formulario; si no llega,
  // se asigna a la sucursal activa de quien lo crea.
  const sucursalFinal = sucursal?.trim() || req.sucursal;

  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, password, rol, sucursal)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, rol, sucursal, activo, created_at`,
      [nombre.trim(), hashed, rolFinal, sucursalFinal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const updateEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);
  const { nombre, password, rol, sucursal } = req.body;
  const callerEsMain = req.user.rol === 'admin_main';

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    const target = targetRows[0];

    if (target.rol === 'admin_main' && !callerEsMain) {
      return res.status(403).json({ message: 'Solo el Admin Main puede modificar al Admin Main.' });
    }

    const updates = [];
    const values  = [];
    let i = 1;

    if (nombre !== undefined) {
      if (!nombre.trim()) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
      updates.push(`nombre = $${i++}`); values.push(nombre.trim());
    }
    if (rol !== undefined) {
      if (!ROL_VALIDOS.includes(rol)) {
        return res.status(400).json({ message: 'Rol inválido.' });
      }
      if (targetId === req.user.id) {
        return res.status(400).json({ message: 'No puedes cambiar tu propio rol.' });
      }
      if (rol === 'admin_main' && !callerEsMain) {
        return res.status(403).json({ message: 'Solo el Admin Main puede asignar este rol.' });
      }
      updates.push(`rol = $${i++}`); values.push(rol);
    }
    if (sucursal !== undefined) {
      if (!sucursal?.trim()) return res.status(400).json({ message: 'La sucursal no puede estar vacía.' });
      updates.push(`sucursal = $${i++}`); values.push(sucursal.trim());
    }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
      }
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${i++}`); values.push(hashed);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No hay campos para actualizar.' });
    }
    values.push(targetId);

    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')}
         WHERE id = $${i} AND activo = TRUE
         RETURNING id, nombre, rol, sucursal, activo, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

export const deleteEmpleado = async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario.' });
  }

  try {
    const { rows: targetRows } = await pool.query(
      'SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE',
      [targetId]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }
    if (targetRows[0].rol === 'admin_main' && req.user.rol !== 'admin_main') {
      return res.status(403).json({ message: 'Solo el Admin Main puede eliminar al Admin Main.' });
    }

    const { rows } = await pool.query(
      `UPDATE usuarios SET activo = FALSE
         WHERE id = $1 AND activo = TRUE
         RETURNING id`,
      [targetId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Empleado no encontrado.' });
    res.json({ message: 'Empleado eliminado.' });
  } catch (err) {
    console.error('deleteEmpleado error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
