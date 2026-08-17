// Cálculos puros del dominio de notas (sin BD ni req): fáciles de probar en
// aislamiento. La lógica de precios/secado/folio vive aquí para poder testearla
// sin levantar Postgres; los controllers la importan.

// Categoría de secado según el TAMAÑO de la secadora: prenda edredón → edredón;
// secadora jumbo → jumbo; resto (incl. secadora sin tamaño) → mediana.
// Devuelve 'mediana' | 'jumbo' | 'edredon'.
export function categoriaSecado(secadoraTamano, tipoPrenda) {
  if (String(tipoPrenda).toUpperCase() === 'EDREDON') return 'edredon';
  if (secadoraTamano === 'jumbo') return 'jumbo';
  return 'mediana';
}

// Tarifa de secado según el tamaño de la secadora (Ajustes → Máquinas):
// mediana = precio_carga_secadora, jumbo = precio_secadora_jumbo, edredón =
// precio_secadora_edredon.
export function tarifaSecadora(secadoraTamano, tipoPrenda, t) {
  const cat = categoriaSecado(secadoraTamano, tipoPrenda);
  if (cat === 'edredon') return t.secadoraEdredon;
  if (cat === 'jumbo')   return t.secadoraJumbo;
  return t.secadora; // mediana
}

// Precio efectivo de un producto dentro de una nota. Los productos por
// tapa/medida van INCLUIDOS (sin costo) en Por Encargo; en Autoservicio se
// cobra su precio por tapa. Los demás productos cobran su precio siempre.
export function precioProductoEnNota(art, tipo_servicio) {
  if (tipo_servicio === 'POR_ENCARGO' && art.es_por_tapa) return 0;
  return art.precio_unitario ?? 0;
}

// Folio legible para el mostrador: SEQ-DDMMYY (id con padding a 4 + fecha).
export function generarFolio(id, fecha) {
  const d = new Date(fecha);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const seq = String(id).padStart(4, '0');
  return `${seq}-${dd}${mm}${yy}`;
}
