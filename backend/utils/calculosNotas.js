// Cálculos puros del dominio de notas (sin BD ni req): fáciles de probar en
// aislamiento. La lógica de precios/secado/folio vive aquí para poder testearla
// sin levantar Postgres; los controllers la importan.
import { fechaLocal } from './tz.js';

// Tarifa de secado: la secadora es de un solo tamaño, así que el precio es
// único (Ajustes → Secadora = precio_carga_secadora). Los parámetros de tamaño
// y prenda se conservan por compatibilidad con los llamadores, pero se ignoran.
export function tarifaSecadora(_secadoraTamano, _tipoPrenda, t) {
  return t.secadora;
}

// Unidad de venta del producto según el servicio: en Autoservicio y en la venta
// de mostrador (PRODUCTOS) se vende la BOTELLA entera; en Por Encargo se cobra
// por TAPA/medida, porque ahí el producto es un insumo del lavado que hace el
// negocio, no algo que el cliente se lleve.
export function unidadDeServicio(tipo_servicio) {
  return tipo_servicio === 'AUTOSERVICIO' || tipo_servicio === 'PRODUCTOS' ? 'botella' : 'tapa';
}

// Cuántas tapas equivale una unidad vendida (para el stock, que va en tapas).
// Una tapa = 1; una botella = floor(botella_ml / tapa_ml) (mín. 1 de respaldo).
export function tapasPorUnidad(art, unidad) {
  if (unidad !== 'botella') return 1;
  const b = Number(art.botella_ml) || 0;
  const t = Number(art.tapa_ml) || 0;
  return t > 0 && b > 0 ? Math.floor(b / t) : 1;
}

// Lo que se vende por UNIDAD entera: los productos de marca (el cliente se
// lleva el envase) y el jabón EN POLVO, que no se sirve por medidas (mig. 126).
// La columna la calcula la BD; el resto se deduce por si el artículo llega sin
// ella (una línea vieja de nota, por ejemplo).
export function seVendePorUnidad(art) {
  if (art?.se_vende_por_unidad != null) return Boolean(art.se_vende_por_unidad);
  return art?.tipo_liquido === 'marca' || art?.forma === 'polvo';
}

// Unidad en la que se vende un producto DENTRO de una nota. El granel líquido se
// sirve por medidas, así que su unidad la decide el servicio (botella en
// Autoservicio, tapa en Por Encargo); lo que se vende por unidad —marca y
// polvo— va siempre por envase completo, porque no se sirve por tapas
// (2026-09-25).
export function unidadDeVenta(art, tipo_servicio) {
  if (seVendePorUnidad(art)) return 'botella';
  return unidadDeServicio(tipo_servicio);
}

// Precio efectivo de un producto dentro de una nota, según la unidad vendida:
// precio por botella/unidad o precio por tapa.
export function precioProductoEnNota(art, tipo_servicio) {
  return unidadDeVenta(art, tipo_servicio) === 'botella'
    ? (art.precio_botella ?? 0)
    : (art.precio_unitario ?? 0);
}

// Folio legible para el mostrador: SEQ-DDMMYY (id con padding a 4 + fecha).
// La fecha es el día del NEGOCIO (America/Mexico_City), no el del servidor: en
// producción Node corre en UTC, así que una nota hecha a las 19:00 locales se
// sellaba con la fecha del día siguiente y el folio del ticket no coincidía
// con el día en que el cliente dejó su ropa.
export function generarFolio(id, fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const [yyyy, mm, dd] = fechaLocal(d).split('-');
  const seq = String(id).padStart(4, '0');
  return `${seq}-${dd}${mm}${yyyy.slice(-2)}`;
}
