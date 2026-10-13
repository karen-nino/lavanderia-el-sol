/**
 * Nombre del estado LISTA según el servicio: "Por Entregar" en Por Encargo y
 * Edredón; en Autoservicio el cliente ya se llevó su ropa y la nota espera su
 * cobro.
 */
export function etiquetaEstadoLista(tipoServicio) {
  return tipoServicio === 'AUTOSERVICIO' ? 'Por Cobrar' : 'Por Entregar';
}

/** Etiqueta del estado: la del badge (`labelBase`), salvo LISTA. */
export function etiquetaEstadoNota(estado, tipoServicio, labelBase) {
  return estado === 'LISTA' ? etiquetaEstadoLista(tipoServicio) : labelBase;
}
