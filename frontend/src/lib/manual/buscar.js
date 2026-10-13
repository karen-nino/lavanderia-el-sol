// Buscador del manual (aparte para poder probarlo).

/** Sin acentos y en minúsculas (como la búsqueda de Notas). */
export function normalizar(s) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Texto de búsqueda: título, cuerpo y claves (palabras con que se buscaría,
// como "cobrar" para "liquidar").
const indice = (art) =>
  normalizar([art.titulo, art.cuerpo, (art.claves ?? []).join(' ')].join(' '));

/** Coincide si contiene todas las palabras de la consulta. */
function coincide(art, palabras) {
  const texto = indice(art);
  return palabras.every((p) => texto.includes(p));
}

/**
 * Secciones con solo los artículos que coinciden (sin secciones vacías);
 * consulta vacía = todo. Primero los que coinciden por título; el resto, en el
 * orden del manual.
 */
export function buscarEnManual(secciones, consulta) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return secciones;

  return secciones
    .map((sec) => {
      const encontrados = sec.articulos.filter((art) => coincide(art, palabras));
      const enTitulo = (art) => {
        const t = normalizar(art.titulo);
        return palabras.every((p) => t.includes(p));
      };
      return {
        ...sec,
        articulos: [...encontrados.filter(enTitulo), ...encontrados.filter((a) => !enTitulo(a))],
      };
    })
    .filter((sec) => sec.articulos.length > 0);
}

/** Cuántos artículos quedaron ("3 resultados"). */
export function contarArticulos(secciones) {
  return secciones.reduce((n, sec) => n + sec.articulos.length, 0);
}
