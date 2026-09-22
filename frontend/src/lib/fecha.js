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

// "Hace cuánto" en texto corto, para marcas de actualización ("Actualizado
// hace 3 min"). Pasado un día ya no sirve la referencia relativa, así que
// cae a la fecha completa. `ahora` se recibe para que el componente que
// re-renderiza con su propio reloj controle el momento de referencia.
export function tiempoRelativo(fecha, ahora = Date.now()) {
  if (fecha == null || fecha === '') return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';

  const seg = Math.floor((ahora - d.getTime()) / 1000);
  if (seg < 0) return 'hace un momento';
  if (seg < 10) return 'hace un momento';
  if (seg < 60) return `hace ${seg} s`;

  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;

  return formatFechaHora12(d);
}
