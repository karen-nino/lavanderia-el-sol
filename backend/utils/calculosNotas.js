// Cálculos puros del dominio de notas (sin BD ni req): fáciles de probar en
// aislamiento. La lógica de precios/secado/folio vive aquí para poder testearla
// sin levantar Postgres; los controllers la importan.

// Tarifa de secado: la secadora es de un solo tamaño, así que el precio es
// único (Ajustes → Secadora = precio_carga_secadora). Los parámetros de tamaño
// y prenda se conservan por compatibilidad con los llamadores, pero se ignoran.
export function tarifaSecadora(_secadoraTamano, _tipoPrenda, t) {
  return t.secadora;
}

// Precio efectivo de un producto dentro de una nota: siempre su precio unitario
// (incluidos los productos por tapa/medida en Por Encargo). En Por Encargo el
// costo de los productos cuenta contra el tope de la carga y suma al total real
// (con techo en el tope); ya no van "incluidos" sin costo.
export function precioProductoEnNota(art /* , tipo_servicio */) {
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
