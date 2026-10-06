// Formas de pago de una nota (espeja el CHECK de notas.forma_pago, mig. 078/090).
//
// `enCajon` marca si ese dinero entra físicamente al cajón: solo el efectivo.
// El corte de caja usa esa distinción — contar transferencias y tarjetas como
// efectivo hacía que el corte marcara un faltante inexistente.

export const FORMAS_PAGO = [
  { v: 'EFECTIVO',      label: 'Efectivo',      enCajon: true  },
  { v: 'TRANSFERENCIA', label: 'Transferencia', enCajon: false },
  { v: 'TARJETA',       label: 'Tarjeta',       enCajon: false },
];

// Las que se ofrecen al COBRAR (pago anticipado, cobrar y el cobro de Nueva
// nota). Tarjeta se ocultó el 2026-10-06 a pedido del negocio: sigue en
// FORMAS_PAGO para que las notas viejas cobradas con tarjeta se lean bien.
export const FORMAS_PAGO_COBRO = FORMAS_PAGO.filter((f) => f.v !== 'TARJETA');

// Etiqueta legible; cadena vacía si no hay forma de pago (nota sin cobrar).
export const formaPagoLabel = (fp) =>
  FORMAS_PAGO.find((f) => f.v === fp)?.label ?? '';
