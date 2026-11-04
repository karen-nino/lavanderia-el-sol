import { TZ_NEGOCIO } from './tz.js';

const fmtDiaHora = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ_NEGOCIO,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const DIAS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Día (0 = lunes … 6 = domingo) y minuto del día en la hora del negocio. */
function diaYMinuto(fecha) {
  const p = Object.fromEntries(fmtDiaHora.formatToParts(fecha).map((x) => [x.type, x.value]));
  return { dia: DIAS_EN.indexOf(p.weekday), minuto: Number(p.hour) * 60 + Number(p.minute) };
}

const aMinutos = (hhmm) => {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/**
 * ¿La sucursal está abierta (o dentro del margen después de cerrar)? Usa el
 * horario por día de Ajustes (mig. 160). Sin horario capturado responde true:
 * mejor de más que dejar de vigilar una sucursal.
 */
export function abiertaConMargen(horarioSemana, fecha = new Date(), margenMin = 0) {
  if (!Array.isArray(horarioSemana) || horarioSemana.length !== 7) return true;
  const { dia, minuto } = diaYMinuto(fecha);
  const dentro = (d, desplazamiento) => {
    const h = horarioSemana.find((x) => Number(x?.dia) === d);
    if (!h?.abierto) return false;
    const abre = aMinutos(h.abre);
    const cierra = aMinutos(h.cierra);
    if (abre == null || cierra == null) return true;
    const m = minuto + desplazamiento;
    return m >= abre && m <= cierra + margenMin;
  };
  /* El margen de ayer puede pasar de la medianoche. */
  return dentro(dia, 0) || dentro((dia + 6) % 7, 24 * 60);
}
