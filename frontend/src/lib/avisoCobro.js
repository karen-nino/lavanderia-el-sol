// Aviso de "cobro invalidado": cuando un cambio en Salidas (una máquina, un
// producto) mueve el total de una nota que ya estaba pagada, el backend la
// devuelve a PENDIENTE. El aviso se muestra en el Detalle de la nota, que es
// donde se ve el estado de pago y está el botón para volver a cobrarla.
//
// Como el cambio pasa en una pantalla y el aviso se lee en otra, la señal viaja
// por sessionStorage (una entrada por nota): sobrevive a la navegación y a un
// refresco, y se va sola al cerrar la pestaña.

const clave = (notaId) => `avisoCobro:${notaId}`;

// Guarda el aviso con los dos importes, para poder decir cuánto falta cobrar.
export function guardarAvisoCobro(notaId, { antes, ahora }) {
  try {
    sessionStorage.setItem(clave(notaId), JSON.stringify({ antes, ahora }));
  } catch { /* sin sessionStorage (modo privado): el aviso simplemente no viaja */ }
}

// Devuelve { antes, ahora } o null si no hay aviso pendiente para esa nota.
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

// Se llama al cobrar la nota o cuando el empleado cierra el aviso.
export function limpiarAvisoCobro(notaId) {
  try {
    sessionStorage.removeItem(clave(notaId));
  } catch { /* nada que limpiar */ }
}
