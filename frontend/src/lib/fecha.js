// Formato de hora unificado en toda la app: 12 horas con cero inicial y
// meridiano en minúsculas sin puntos → "09:05 am", "02:30 pm", "12:00 am".
// Se usa en-US (que da "09:05 AM") + toLowerCase para lograr ese estilo exacto,
// que es el elegido por el negocio.

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
