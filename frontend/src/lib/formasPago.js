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

// Etiqueta legible; cadena vacía si no hay forma de pago (nota sin cobrar).
export const formaPagoLabel = (fp) =>
  FORMAS_PAGO.find((f) => f.v === fp)?.label ?? '';
