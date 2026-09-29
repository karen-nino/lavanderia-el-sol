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

  // La firma del token no basta: el usuario pudo ser desactivado o cambiar
  // de rol/sucursal después de emitirlo. Se releen de la base en cada
  // petición para que desactivar a alguien corte su sesión de inmediato.
  try {
    // Con reintento: esta consulta la atraviesa CADA petición autenticada, así
    // que una conexión que el pooler soltó no tumba una, tumba todas a la vez
    // (pasó el 2026-09-29). Es de solo lectura: repetirla no cambia nada.
    const { rows } = await consultarReintentando(
      'SELECT id, rol, sucursal, es_prueba, session_id FROM usuarios WHERE id = $1 AND activo = TRUE',
      [decoded.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Tu sesión se cerró. Inicia sesión de nuevo.' });
    }

    // Sesión única por cuenta: si el id de sesión del token no coincide con el
    // vigente, significa que se inició sesión en otro dispositivo después. Se
    // rechaza para que la sesión anterior quede cerrada.
    if (rows[0].session_id && decoded.sid !== rows[0].session_id) {
      return res.status(401).json({ message: 'Se inició sesión en otro dispositivo.' });
    }

    const { session_id, ...user } = rows[0];
    req.user = user;
    next();
  } catch (err) {
    console.error('verifyToken error:', err);
    // No se pudo llegar a la base: la sesión del empleado está perfectamente
    // bien, el que no contesta es el servidor. Mandarlo a iniciar sesión otra
    // vez —lo que decía antes— le hace perder el tiempo en algo que no arregla
    // nada. 503 y a reintentar.
    if (esErrorDeConexion(err)) {
      return res.status(503).json({
        message: 'El servidor no responde en este momento. Espera unos segundos y vuelve a intentar.',
      });
    }
    res.status(500).json({ message: 'No se pudo validar tu sesión. Vuelve a iniciar sesión.' });
  }
};
