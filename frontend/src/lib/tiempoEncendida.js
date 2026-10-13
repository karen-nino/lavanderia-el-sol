import { formatHora12 } from './fecha';

/**
 * Cuánto estuvo encendida una máquina, del arranque a Finalizar: "38 min",
 * "1 h 05 min"; menos de un minuto, "-1 min". Null sin tiempo sellado.
 */
export function fmtEncendida(segundos) {
  if (segundos == null) return null;
  if (segundos < 60) return '-1 min';
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Igual, y si llegó al tope del cronómetro lo dice. */
export function fmtEncendidaConTope(segundos, tope) {
  const t = fmtEncendida(segundos);
  if (t == null) return null;
  return tope ? `Tope de tiempo · ${t}` : t;
}

/** "09:05 am – 09:52 am"; "Desde 09:05 am" si sigue corriendo. Null sin hora de arranque. */
export function horarioCiclo(c) {
  if (!c?.inicio_at) return null;
  const inicio = formatHora12(c.inicio_at);
  return c.fin_at ? `${inicio} – ${formatHora12(c.fin_at)}` : `Desde ${inicio}`;
}
