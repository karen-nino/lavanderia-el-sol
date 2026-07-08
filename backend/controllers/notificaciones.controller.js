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
        ORDER BY n.created_at DESC`,
      [req.sucursal]
    );
    res.json(rows);
  } catch (err) {
    console.error('getNotificaciones error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ── DELETE /notificaciones/:id ──────────────────────────────
// Descarta manualmente una notificación de la sucursal activa.
export const deleteNotificacion = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'Notificación inválida.' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM notificaciones WHERE id = $1 AND sucursal = $2',
      [id, req.sucursal]
    );
    if (rowCount === 0) return res.status(404).json({ message: 'Notificación no encontrada.' });
    res.status(204).send();
  } catch (err) {
    console.error('deleteNotificacion error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
