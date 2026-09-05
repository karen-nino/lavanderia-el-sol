// Buscador del manual. Vive aparte de la página para poder probarlo: es la
// única pieza del manual con reglas propias, y la que se rompe en silencio (un
// artículo que existe pero no aparece al buscarlo no da ningún error).

// Sin acentos y en minúsculas: en el mostrador nadie escribe "jabón" con tilde.
// (La lista de Notas hace lo mismo para buscar folios y clientes.)
export function normalizar(s) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Texto sobre el que se busca un artículo: su título, su cuerpo y las palabras
// con las que la gente lo buscaría aunque no aparezcan escritas. Las claves
// importan más de lo que parece: se busca "cobrar", y el artículo dice
// "liquidar".
const indice = (art) =>
  normalizar([art.titulo, art.cuerpo, (art.claves ?? []).join(' ')].join(' '));

// Coincide el artículo que contiene TODAS las palabras de la consulta (no
// cualquiera de ellas): "cobrar tarjeta" debe traer el artículo del cobro, no
// todo lo que hable de tarjetas.
function coincide(art, palabras) {
  const texto = indice(art);
  return palabras.every((p) => texto.includes(p));
}

// Devuelve las secciones con solo los artículos que coinciden; las que se
// quedan sin ninguno no se devuelven, para no dejar encabezados huérfanos.
// Consulta vacía = el manual entero, sin filtrar.
//
// Orden: primero los artículos cuyo TÍTULO coincide, que casi siempre son los
// que se buscaban; el resto conserva el orden del manual, que va de lo más
// común a lo más raro.
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

// Cuántos artículos quedaron, para poder decir "3 resultados" sin recorrer de
// nuevo la lista en la pantalla.
export function contarArticulos(secciones) {
  return secciones.reduce((n, sec) => n + sec.articulos.length, 0);
}
