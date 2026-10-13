/**
 * Aviso de cobro invalidado: si un cambio en Salidas mueve el total de una nota
 * pagada, el backend la devuelve a PENDIENTE y el aviso sale en su detalle. Viaja
 * por sessionStorage (una entrada por nota).
 */

const clave = (notaId) => `avisoCobro:${notaId}`;

/** Guarda el aviso con los dos importes. */
export function guardarAvisoCobro(notaId, { antes, ahora }) {
  try {
    sessionStorage.setItem(clave(notaId), JSON.stringify({ antes, ahora }));
  } catch { /* sin sessionStorage (modo privado): el aviso simplemente no viaja */ }
}

/** { antes, ahora } o null si no hay aviso para esa nota. */
export function leerAvisoCobro(notaId) {
  try {
    const raw = sessionStorage.getItem(clave(notaId));
    if (!raw) return null;
    const { antes, ahora } = JSON.parse(raw);
    return Number.isFinite(Number(antes)) && Number.isFinite(Number(ahora))
      ? { antes: Number(antes), ahora: Number(ahora) }
      : null;
  } catch {
    return null;
  }
}

/** Al cobrar la nota o al cerrar el aviso. */
export function limpiarAvisoCobro(notaId) {
  try {
    sessionStorage.removeItem(clave(notaId));
  } catch { /* nada que limpiar */ }
}
