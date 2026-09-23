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
// CANCELADA, y aquí se sigue esa misma regla.
//
// FINALIZADA incluida: una nota terminada a la que le revirtieron el pago
// vuelve a deber, y antes el detalle se quedaba sin un solo botón para
// cobrarla —el dinero quedaba fuera de la app (2026-09-23)—. Cobrar una nota ya
// cerrada no mueve su estado ni su inventario: solo registra el pago.
export const puedeLiquidar = (nota) =>
  nota?.estado_pago === 'PENDIENTE' && nota?.estado !== 'CANCELADA';

// Finalizar es el último paso —la ropa se entregó— y exige que ya esté cobrada:
// una nota pendiente no se puede dar por entregada.
export const puedeFinalizar = (nota) =>
  !esTerminal(nota) && nota?.estado === 'LISTA' && nota?.estado_pago !== 'PENDIENTE';

// Borrar una nota es de admin, en cualquier estado: el servidor lo permite y
// hay casos en los que hace falta sin pasar por cancelar (una nota cobrada no
// se puede cancelar sin revertir antes el pago, y eso son tres pasos para algo
// que a veces solo es un error de captura).
//
// La excepción es el cobro ya congelado en un corte cerrado (`cobro_congelado`,
// mig. 101): ahí el servidor responde 409 y el botón solo llevaría a un error,
// igual que ya pasa con editar, cancelar y revertir el pago (2026-09-23).
export const puedeEliminar = (nota, esAdmin) =>
  Boolean(esAdmin) && !nota?.cobro_congelado;

// …pero en TÁCTIL, mientras la nota sigue viva, el botón no se enseña. Ahí
// está pegado a Cancelar, se pulsa con el dedo y borrar no se deshace: lo que
// se pierde es el rastro de que la nota existió. En el mostrador el camino es
// cancelar; el borrado directo queda para el escritorio, donde se administra
// con calma. El corte lo pone la página con `pointer-fine` (mouse o trackpad)
// y no por ancho: una tablet grande mide lo mismo que una laptop
// (2026-09-22). Ya cerrada, el botón se ve en todas partes (2026-09-21).
export const eliminarSoloEnEscritorio = (nota) => !esTerminal(nota);
