// Zona horaria del negocio. El "día" del negocio se corta a medianoche local
// (America/Mexico_City), igual que el cierre del día (jobs/cierreDelDia.js).
// Configurable con TZ_NEGOCIO.
export const TZ_NEGOCIO = process.env.TZ_NEGOCIO || 'America/Mexico_City';

const fmtFechaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Devuelve la fecha local del negocio como 'YYYY-MM-DD' para la fecha/hora dada
// (por defecto, ahora).
export const fechaLocal = (d = new Date()) => fmtFechaLocal.format(d);
