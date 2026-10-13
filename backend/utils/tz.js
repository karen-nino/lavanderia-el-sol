/** Zona del negocio (TZ_NEGOCIO, por defecto America/Mexico_City): el día corta a medianoche local. */
export const TZ_NEGOCIO = process.env.TZ_NEGOCIO || 'America/Mexico_City';

const fmtFechaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha local del negocio 'YYYY-MM-DD' (por defecto, de ahora). */
export const fechaLocal = (d = new Date()) => fmtFechaLocal.format(d);

/**
 * ¿Es una fecha 'YYYY-MM-DD' que existe? No basta la forma: '2026-99-99' o
 * '2026-02-30' tumbarían el ::date de Postgres.
 */
export function esFechaISO(valor) {
  const s = String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [anio, mes, dia] = s.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    d.getUTCFullYear() === anio &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}
