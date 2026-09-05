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

// ¿Es una fecha 'YYYY-MM-DD' que existe de verdad?
//
// Comprobar solo la forma con una expresión regular no alcanza: '2026-99-99' la
// pasa, llega a la consulta como ::date y Postgres tumba la petición con un
// 500. Se reconstruye la fecha y se compara con lo que entró, que además
// descarta los días que no existen ('2026-02-30' se desbordaría a marzo).
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
