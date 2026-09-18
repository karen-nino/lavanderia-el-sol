// Cuál de las dos notas al pie del ticket (Ajustes → Ticket) le toca a una nota.
//
// Vive fuera de TicketNota para poder probarla y para que Fast Refresh siga
// funcionando en la página (que solo debe exportar el componente), igual que
// [[ticketCargas]].

// El edredón lo lava y lo entrega el negocio, igual que un encargo: los dos
// llevan la MISMA nota. La de autoservicio es solo para quien lava él mismo.
// Decisión de la clienta (2026-09-05), no una deducción del código: sin esto,
// que el edredón caiga del lado del encargo parece un "todo lo demás"
// descuidado.
//
// La venta de mostrador (PRODUCTOS) tiene la SUYA (mig. 113): empezó usando la
// de autoservicio y en el papel no servía — ese texto habla de lavadora y
// minutos de secadora, y quien solo vino a comprar un suavizante no lava nada.
// Sin fallback a propósito: si no está capturada, el ticket de la venta sale
// sin nota, igual que cualquier otro con su nota vacía.
//
// Cualquier tipo de servicio que se agregue en el futuro hereda la del encargo;
// si no es lo que se quiere, hay que decidirlo aquí.
const NOTA_POR_SERVICIO = {
  AUTOSERVICIO: 'autoservicio',
  PRODUCTOS:    'productos',
};

export function notaAlPieDeTicket(tipoServicio, notas) {
  return notas?.[NOTA_POR_SERVICIO[tipoServicio] ?? 'encargo'] ?? '';
}
