// Período de un filtro por fechas (Hoy, Esta semana, Mes, Año, Personalizado),
// como el historial de Caja. Lo usa components/SelectorPeriodo.

/** Opciones del selector. */
export const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Mes' },
  { id: 'anio',   label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];

/** Nombres de meses capitalizados (Enero … Diciembre). */
export const MESES = Array.from({ length: 12 }, (_, i) => {
  const m = new Date(2020, i, 1).toLocaleDateString('es-MX', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
});

/** Lunes 00:00 de la semana de `fecha`. */
export const inicioSemana = (fecha) => {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

/** Período inicial: hoy, con el mes y el año en curso para cuando se elijan. */
export const periodoInicial = () => {
  const hoy = new Date();
  return { periodo: 'hoy', anio: hoy.getFullYear(), mes: hoy.getMonth(), desde: '', hasta: '' };
};

/** Rango [desde, hasta) del período; null = personalizado sin fechas completas. */
export function rangoDePeriodo({ periodo, anio, mes, desde, hasta }) {
  const ahora = new Date();
  const hoy0 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  switch (periodo) {
    case 'hoy':
      return { desde: hoy0, hasta: new Date(hoy0.getFullYear(), hoy0.getMonth(), hoy0.getDate() + 1) };
    case 'semana': {
      const l = inicioSemana(ahora);
      return { desde: l, hasta: new Date(l.getFullYear(), l.getMonth(), l.getDate() + 7) };
    }
    case 'mes':
      return { desde: new Date(anio, mes, 1), hasta: new Date(anio, mes + 1, 1) };
    case 'anio':
      return { desde: new Date(anio, 0, 1), hasta: new Date(anio + 1, 0, 1) };
    case 'custom': {
      if (!desde || !hasta) return null;
      const h = new Date(`${hasta}T00:00:00`);
      h.setDate(h.getDate() + 1);
      return { desde: new Date(`${desde}T00:00:00`), hasta: h };
    }
    default:
      return null;
  }
}

/** Texto del período elegido: "Hoy", "Esta semana", "Noviembre 2026", "2026", "1 - 10 de Noviembre". */
export function etiquetaPeriodo({ periodo, anio, mes, desde, hasta }) {
  switch (periodo) {
    case 'hoy': return 'Hoy';
    case 'semana': return 'Esta semana';
    case 'mes': return `${MESES[mes]} ${anio}`;
    case 'anio': return `${anio}`;
    case 'custom': {
      if (!desde || !hasta) return 'Personalizado';
      const d1 = new Date(`${desde}T00:00:00`);
      const d2 = new Date(`${hasta}T00:00:00`);
      return d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
        ? `${d1.getDate()} - ${d2.getDate()} de ${MESES[d2.getMonth()]} ${d2.getFullYear()}`
        : `${d1.getDate()} de ${MESES[d1.getMonth()]} - ${d2.getDate()} de ${MESES[d2.getMonth()]} ${d2.getFullYear()}`;
    }
    default: return '';
  }
}
