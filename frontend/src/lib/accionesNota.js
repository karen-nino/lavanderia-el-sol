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
