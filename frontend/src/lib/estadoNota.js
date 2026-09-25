// Cómo se le dice al estado LISTA según el servicio de la nota.
//
// En Por Encargo y Edredón la ropa se queda en la lavandería y la nota espera a
// que la recojan: "Por Entregar". En Autoservicio el cliente se llevó su ropa
// él mismo, así que ahí no hay nada que entregar: lo que esa nota espera es su
// cobro, y al liquidarla se finaliza sola (2026-09-23). Llamarla "Por Entregar"
// prometía una entrega que no existe (2026-09-25).
export function etiquetaEstadoLista(tipoServicio) {
  return tipoServicio === 'AUTOSERVICIO' ? 'Por Cobrar' : 'Por Entregar';
}

// Etiqueta del estado de una nota: la de su badge, salvo LISTA, que depende del
// servicio. `labelBase` es lo que diría el badge de esa página.
export function etiquetaEstadoNota(estado, tipoServicio, labelBase) {
  return estado === 'LISTA' ? etiquetaEstadoLista(tipoServicio) : labelBase;
}
