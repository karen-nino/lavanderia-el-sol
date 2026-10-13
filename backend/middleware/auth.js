import jwt from 'jsonwebtoken';
import { consultarReintentando } from '../db/pool.js';
import { esErrorDeConexion } from '../utils/erroresDb.js';

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Tu sesión terminó. Inicia sesión de nuevo.' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Tu sesión expiró. Inicia sesión de nuevo.' });
  }

  // Rol, sucursal y estado se releen en cada petición: desactivar a alguien
  // corta su sesión de inmediato.
  try {
    // Con reintento: la cruza cada petición y es de solo lectura.
    const { rows } = await consultarReintentando(
      'SELECT id, rol, sucursal, es_prueba, session_id FROM usuarios WHERE id = $1 AND activo = TRUE',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Tu sesión se cerró. Inicia sesión de nuevo.' });
    }

    // Sesión única: si el sid no coincide, se entró desde otro dispositivo.
    if (rows[0].session_id && decoded.sid !== rows[0].session_id) {
      return res.status(401).json({ message: 'Se inició sesión en otro dispositivo.' });
    }

    const { session_id, ...user } = rows[0];
    req.user = user;
    next();
  } catch (err) {
    console.error('verifyToken error:', err);
    // Sin base de datos: la sesión está bien, se responde 503 para reintentar.
    if (esErrorDeConexion(err)) {
      return res.status(503).json({
        message: 'El servidor no responde en este momento. Espera unos segundos y vuelve a intentar.',
      });
    }
    res.status(500).json({ message: 'No se pudo validar tu sesión. Vuelve a iniciar sesión.' });
  }
};
