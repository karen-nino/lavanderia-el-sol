import rateLimit from 'express-rate-limit';

// Limitadores para las rutas públicas de /api/auth (auditoría A2).
// La IP del cliente sale de req.ip: index.js declara trust proxy = 1
// porque en Fly el proxy agrega la IP real como última entrada de
// X-Forwarded-For. El tráfico que llega vía Netlify comparte la IP del
// edge, por eso el login solo cuenta intentos fallidos.

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' },
});

export const busquedaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas búsquedas. Espera un momento.' },
});
