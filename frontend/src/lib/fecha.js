/**
 * Hora de 12 h con cero inicial y meridiano en minúsculas: "09:05 am". Se usa
 * en-US ("09:05 AM") y se pasa a minúsculas.
 */

export function formatHora12(fecha) {
  if (fecha == null || fecha === '') return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    .toLowerCase();
}

// Fecha corta + hora: "15 ago 2026, 09:05 am".
export function formatFechaHora12(fecha) {
  if (fecha == null || fecha === '') return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const dia = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${dia}, ${formatHora12(d)}`;
}
