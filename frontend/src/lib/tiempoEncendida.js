import { formatHora12 } from './fecha';

// Cuánto estuvo encendida una máquina, de que arrancó a que se le dio
// Finalizar (migs. 140-141): "38 min", "1 h 05 min". Menos de un minuto se lee
// "-1 min" ("menos de 1"), no "0 min". Null si no hay tiempo sellado.
// Lo usan Ventas (modal de máquinas de la nota) e Información de uso (ciclos).
export function fmtEncendida(segundos) {
  if (segundos == null) return null;
  if (segundos < 60) return '-1 min';
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

// Igual, pero si llegó al tope del cronómetro lo dice: ahí se paró el reloj.
export function fmtEncendidaConTope(segundos, tope) {
  const t = fmtEncendida(segundos);
  if (t == null) return null;
  return tope ? `Tope de tiempo · ${t}` : t;
}

// "09:05 am – 09:52 am" de un ciclo; "Desde 09:05 am" si sigue corriendo.
// Null si no hay hora de arranque (pasadas anteriores a la mig. 140). Lo usan
// Información de uso (máquina) y el desempeño del empleado.
export function horarioCiclo(c) {
  if (!c?.inicio_at) return null;
  const inicio = formatHora12(c.inicio_at);
  return c.fin_at ? `${inicio} – ${formatHora12(c.fin_at)}` : `Desde ${inicio}`;
}
