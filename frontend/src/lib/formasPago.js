/**
 * Formas de pago (espeja el CHECK de notas.forma_pago). `enCajon`: solo el
 * efectivo entra al cajón, y así lo cuenta el corte.
 */

export const FORMAS_PAGO = [
  { v: 'EFECTIVO',      label: 'Efectivo',      enCajon: true  },
  { v: 'TRANSFERENCIA', label: 'Transferencia', enCajon: false },
  { v: 'TARJETA',       label: 'Tarjeta',       enCajon: false },
];

/** Las que se ofrecen al cobrar. Tarjeta no, pero sigue en FORMAS_PAGO para leer cobros viejos. */
export const FORMAS_PAGO_COBRO = FORMAS_PAGO.filter((f) => f.v !== 'TARJETA');

// Etiqueta legible; cadena vacía si no hay forma de pago (nota sin cobrar).
export const formaPagoLabel = (fp) =>
  FORMAS_PAGO.find((f) => f.v === fp)?.label ?? '';
