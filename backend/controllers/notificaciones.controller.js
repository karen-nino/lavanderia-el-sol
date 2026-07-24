import pool from '../db/pool.js';

// ── GET /notificaciones ─────────────────────────────────────
// Notificaciones de la sucursal activa de las últimas 24 h (las más
// viejas se "descartan" solas por antigüedad). Newest first.
export const getNotificaciones = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.tipo, n.mensaje, n.maquina_id, n.created_at,
              m.nombre AS maquina_nombre,
              u.nombre AS usuario_nombre
         FROM notificaciones n
         LEFT JOIN maquinas m ON m.id = n.maquina_id
         LEFT JOIN usuarios u ON u.id = n.usuario_id
        WHERE n.sucursal = $1
          AND n.created_at >= NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM notificacion_descartes d
             WHERE d.notificacion_id = n.id AND d.usuario_id = $2
          )
        ORDER BY n.created_at DESC`,
      [req.sucursal, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotificaciones error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /notificaciones/:id/descartar ──────────────────────
// Descarta la notificación solo para el usuario actual (los demás la
// siguen viendo). La notificación no se borra; se registra el descarte.
export const descartarNotificacion = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Notificación inválida.' });
  try {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM notificaciones WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Notificación no encontrada.' });

    await pool.query(
      `INSERT INTO notificacion_descartes (notificacion_id, usuario_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, req.user.id]
    );
    res.status(204).send();
  } catch (err) {
    console.error('descartarNotificacion error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── POST /notificaciones/descartar-todas ────────────────────
// Descarta para el usuario actual todas las notificaciones que hoy ve en la
// campana (sucursal activa, últimas 24 h). Igual que el descarte individual, no
// borra nada ni afecta a los demás usuarios.
export const descartarTodas = async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO notificacion_descartes (notificacion_id, usuario_id)
       SELECT n.id, $2 FROM notificaciones n
        WHERE n.sucursal = $1
          AND n.created_at >= NOW() - INTERVAL '24 hours'
       ON CONFLICT DO NOTHING`,
      [req.sucursal, req.user.id]
    );
    res.status(204).send();
  } catch (err) {
    console.error('descartarTodas error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
