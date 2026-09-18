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
// La venta de mostrador (PRODUCTOS) va con la de AUTOSERVICIO, por decisión de
// la clienta (2026-09-18): el cliente se lleva lo que compró en el momento, no
// deja nada a cargo del negocio. Cualquier tipo que se agregue en el futuro
// hereda la del encargo mientras no se decida aquí.
const NOTA_AUTOSERVICIO = ['AUTOSERVICIO', 'PRODUCTOS'];

export function notaAlPieDeTicket(tipoServicio, notas) {
  return NOTA_AUTOSERVICIO.includes(tipoServicio)
    ? (notas?.autoservicio ?? '')
    : (notas?.encargo ?? '');
}
