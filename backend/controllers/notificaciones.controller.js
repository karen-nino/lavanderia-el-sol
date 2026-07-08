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
