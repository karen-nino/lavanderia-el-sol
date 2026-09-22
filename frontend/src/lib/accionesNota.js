// Qué botones ofrece el detalle de una nota.
//
// Vive fuera de la página para poder probarlo: son reglas de negocio pequeñas
// pero con muchas combinaciones (estado de la nota × estado del pago), y hasta
// ahora estaban escritas dentro del JSX.

// Una nota terminada no acepta acciones: solo se puede mirar (o borrar, que va
// aparte porque es de admin).
export const esTerminal = (nota) => ['FINALIZADA', 'CANCELADA'].includes(nota?.estado);

// Cobrar se puede desde que la nota existe, no solo cuando la ropa está lista.
// En Por Encargo el cliente suele pagar al dejar la ropa, y el botón tiene que
// estar donde ocurre el cobro. El servidor lo permite en cualquier estado menos
// CANCELADA.
export const puedeLiquidar = (nota) =>
  !esTerminal(nota) && nota?.estado_pago === 'PENDIENTE';

// Finalizar es el último paso —la ropa se entregó— y exige que ya esté cobrada:
// una nota pendiente no se puede dar por entregada.
export const puedeFinalizar = (nota) =>
  !esTerminal(nota) && nota?.estado === 'LISTA' && nota?.estado_pago !== 'PENDIENTE';

// Borrar una nota es de admin, en cualquier estado: el servidor lo permite y
// hay casos en los que hace falta sin pasar por cancelar (una nota cobrada no
// se puede cancelar sin revertir antes el pago, y eso son tres pasos para algo
// que a veces solo es un error de captura).
export const puedeEliminar = (nota, esAdmin) => Boolean(esAdmin);

// …pero en TÁCTIL, mientras la nota sigue viva, el botón no se enseña. Ahí
// está pegado a Cancelar, se pulsa con el dedo y borrar no se deshace: lo que
// se pierde es el rastro de que la nota existió. En el mostrador el camino es
// cancelar; el borrado directo queda para el escritorio, donde se administra
// con calma. El corte lo pone la página en `xl` (1280px): con `md` la tablet
// entraba como escritorio (2026-09-22). Ya cerrada, el botón se ve en todos
// los tamaños (2026-09-21).
export const eliminarSoloEnEscritorio = (nota) => !esTerminal(nota);
