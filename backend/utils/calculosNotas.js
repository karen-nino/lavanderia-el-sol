// Cálculos puros de notas (sin BD ni req), para probarlos sin Postgres.
import { fechaLocal } from './tz.js';

/**
 * Precio del secado: uno solo (Ajustes → Secadora). Tamaño y prenda se ignoran;
 * se conservan por compatibilidad con quien la llama.
 */
export function tarifaSecadora(_secadoraTamano, _tipoPrenda, t) {
  return t.secadora;
}

/**
 * Unidad del granel según el servicio: botella en Autoservicio y venta de
 * productos; medida en Por Encargo (ahí es insumo del lavado).
 */
export function unidadDeServicio(tipo_servicio) {
  return tipo_servicio === 'AUTOSERVICIO' || tipo_servicio === 'PRODUCTOS' ? 'botella' : 'medida';
}

/** Medidas que vale una unidad: medida = 1; botella = floor(botella_ml / medida_ml), mínimo 1. */
export function medidasPorUnidad(art, unidad) {
  if (unidad !== 'botella') return 1;
  const b = Number(art.botella_ml) || 0;
  const t = Number(art.medida_ml) || 0;
  return t > 0 && b > 0 ? Math.floor(b / t) : 1;
}

/**
 * ¿Se vende por unidad entera? Marca y polvo. Usa la columna de la BD y, si no
 * viene, lo deduce.
 */
export function seVendePorUnidad(art) {
  if (art?.se_vende_por_unidad != null) return Boolean(art.se_vende_por_unidad);
  return art?.tipo_liquido === 'marca' || art?.forma === 'polvo';
}

/** Unidad del producto en una nota: marca y polvo, siempre 'botella'; el granel, según el servicio. */
export function unidadDeVenta(art, tipo_servicio) {
  if (seVendePorUnidad(art)) return 'botella';
  return unidadDeServicio(tipo_servicio);
}

/** Precio del producto en una nota: por botella o unidad, o por medida. */
export function precioProductoEnNota(art, tipo_servicio) {
  return unidadDeVenta(art, tipo_servicio) === 'botella'
    ? (art.precio_botella ?? 0)
    : (art.precio_unitario ?? 0);
}

/**
 * Folio "0041-121026": consecutivo de la sucursal a 4 dígitos + fecha DDMMYY del
 * negocio (no la del servidor en UTC).
 */
export function generarFolio(id, fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const [yyyy, mm, dd] = fechaLocal(d).split('-');
  const seq = String(id).padStart(4, '0');
  return `${seq}-${dd}${mm}${yyyy.slice(-2)}`;
}
