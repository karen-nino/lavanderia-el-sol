import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  // La firma del token no basta: el usuario pudo ser desactivado o cambiar
  // de rol/sucursal después de emitirlo. Se releen de la base en cada
  // petición para que desactivar a alguien corte su sesión de inmediato.
  try {
    const { rows } = await pool.query(
      'SELECT id, rol, sucursal FROM usuarios WHERE id = $1 AND activo = TRUE',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Sesión revocada. Inicia sesión de nuevo.' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    console.error('verifyToken error:', err);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
