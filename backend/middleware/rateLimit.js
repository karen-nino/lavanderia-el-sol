import rateLimit from 'express-rate-limit';

// Limitadores de las rutas públicas de /api/auth. La IP sale de req.ip (trust
// proxy = 1 en index.js, por el proxy de Fly). El tráfico que pasa por el
// proxy del frontend comparte la IP del edge: por eso el login solo cuenta
// intentos fallidos y los topes no son por persona.

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

/**
 * Techo por hora contra quien enumera despacio. Alto a propósito: lo comparten
 * todos los empleados (misma IP del edge) y cada tecla del login es una
 * búsqueda; barrer la plantilla requiere miles.
 */
export const busquedaLimiterHora = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas búsquedas. Espera un momento.' },
});

/**
 * Entrada a la demo: cuenta todas las peticiones. No usa loginLimiter porque
 * unos cuantos errores (la base despertando) cerrarían la demo a todos los que
 * comparten la IP del edge.
 */
export const demoLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'La demo está recibiendo muchas visitas. Espera un momento.' },
});
