/**
 * Recuerda la URL de la lista de notas (con sus filtros) para el "Volver" del
 * detalle. En sessionStorage y no en el state de navegación, porque las
 * pantallas intermedias (ticket, editar, Salidas) lo perderían.
 */
const CLAVE = 'notas:volverA';

export function recordarListaNotas(url) {
  try { sessionStorage.setItem(CLAVE, url); } catch { /* ignore */ }
}

/** Sin nada guardado (enlace directo), la lista sin filtros. */
export function urlListaNotas() {
  try { return sessionStorage.getItem(CLAVE) || '/notas'; } catch { return '/notas'; }
}
