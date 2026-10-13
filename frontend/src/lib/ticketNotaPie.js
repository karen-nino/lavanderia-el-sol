// Qué nota al pie del ticket (Ajustes → Ticket) le toca a una nota (aparte para
// probarla y para Fast Refresh).

/**
 * Edredón lleva la misma nota que Por Encargo (lo lava el negocio). La venta de
 * mostrador tiene la suya, sin respaldo: vacía, el ticket sale sin nota. Un
 * servicio nuevo hereda la de Por Encargo.
 */
const NOTA_POR_SERVICIO = {
  AUTOSERVICIO: 'autoservicio',
  PRODUCTOS:    'productos',
};

export function notaAlPieDeTicket(tipoServicio, notas) {
  return notas?.[NOTA_POR_SERVICIO[tipoServicio] ?? 'encargo'] ?? '';
}
