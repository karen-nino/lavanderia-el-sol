// Recuerda cómo quedó la lista de notas (sus filtros de estado y fecha viajan
// en la URL) para que el botón "Volver" del detalle de una nota regrese al
// mismo filtro en vez de reiniciar la vista en "Hoy".
//
// Vive en sessionStorage y no en el state de la navegación porque tiene que
// sobrevivir a las pantallas intermedias —ticket, editar, salidas—, que al
// regresar al detalle empujan una entrada nueva del historial y perderían ese
// dato. Se borra sola al cerrar la app.
const CLAVE = 'notas:volverA';

export function recordarListaNotas(url) {
  try { sessionStorage.setItem(CLAVE, url); } catch { /* ignore */ }
}

// La lista sin filtros es el respaldo: al abrir una nota por un enlace directo
// o desde otra pantalla no hay nada que recordar.
export function urlListaNotas() {
  try { return sessionStorage.getItem(CLAVE) || '/notas'; } catch { return '/notas'; }
}
