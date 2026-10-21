/**
 * Textos del Reporte diario de Máquinas (pantalla y exportación). Recibe lo de
 * GET /maquinas/reporte-diario: { fecha, maquinas: [{ ..., pasadas }] }.
 */
import { formatHora12 } from './fecha';

/** Tipo de máquina en texto: "Lavadora mediana", "Secadora jumbo". */
export function tipoMaquinaTexto(m) {
  if (m?.tipo === 'lavadora_jumbo') return 'Lavadora jumbo';
  if (m?.tipo === 'lavadora_mediana') return 'Lavadora mediana';
  if (m?.tipo === 'secadora') return m.tamano === 'jumbo' ? 'Secadora jumbo' : 'Secadora mediana';
  return 'Máquina';
}

/** ¿Es secadora? (para separar los dos grupos). */
export const esSecadora = (m) => m?.tipo === 'secadora';

/** Segundos a "1 h 05 min", "45 min" o "menos de 1 min"; sin dato, un guion. */
export function textoDuracion(segundos) {
  if (segundos == null) return '—';
  const min = Math.floor(Number(segundos) / 60);
  if (min < 1) return Number(segundos) > 0 ? 'menos de 1 min' : '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** "$1,250.00". */
export const textoMoneda = (n) =>
  '$' + Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Horario de una vuelta: "10:15 am – 10:45 am" o "desde 10:15 am (en curso)". */
export function horarioPasada(p) {
  const inicio = formatHora12(p.inicio_at);
  if (p.en_curso) return `desde ${inicio} (en curso)`;
  return p.fin_at ? `${inicio} – ${formatHora12(p.fin_at)}` : inicio;
}

/** Servicio de la nota en texto corto. */
export const SERVICIO_TEXTO = {
  AUTOSERVICIO: 'Autoservicio', POR_ENCARGO: 'Por Encargo', EDREDON: 'Edredón', PRODUCTOS: 'Productos',
};

/** Totales del día: vueltas, segundos y lo generado. */
export function totalesReporte(maquinas = []) {
  return maquinas.reduce((t, m) => ({
    usos: t.usos + m.usos, segundos: t.segundos + m.segundos, topes: t.topes + m.topes, generado: t.generado + m.generado,
  }), { usos: 0, segundos: 0, topes: 0, generado: 0 });
}
