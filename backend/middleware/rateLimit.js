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

// Segundo techo, de ventana larga: el de arriba frena la ráfaga, pero no a
// quien enumera despacio (29 búsquedas por minuto durante horas).
//
// El tope es alto a propósito. Como dice la nota de arriba, el tráfico que
// entra por Netlify comparte la IP del edge, así que este cupo NO es por
// persona: lo gastan entre todos los empleados de todas las sucursales. Y cada
// tecla cuenta —el login busca con un debounce de 200 ms—, así que un inicio de
// sesión son varias peticiones, no una. Con 600 por hora un turno real no lo
// roza, y para barrer la plantilla por prefijos hacen falta miles: el freno
// sigue puesto donde importa.
export const busquedaLimiterHora = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas búsquedas. Espera un momento.' },
});
