// Cómo se listan las cargas de una nota en el ticket del cliente. Vive fuera de
// TicketNota para poder probarlo y para que Fast Refresh siga funcionando en la
// página (que solo debe exportar el componente).

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

// Lo que la carga cobra por máquina. Al cliente se le nombra siempre el tipo
// de máquina ("Lavadora · Mediana"), no la máquina física que le tocó ("L1"):
// el identificador es de uso interno y en el ticket no le dice nada. El tamaño
// sale de la máquina asignada, o del tipo elegido al crear la nota mientras no
// haya una.
//
// En AUTOSERVICIO el tipo elegido no basta (2026-09-25): ahí la máquina se
// cobra al asignarla en Salidas, así que mientras no haya máquina física no hay
// nada que enseñar — el ticket mostraría una máquina y un precio que todavía no
// existen. En Por Encargo sí se anuncia el tipo elegido, porque la carga se
// cobra por su tope desde que se hace la nota.
export function maquinasDeCarga(cg, tipoServicio) {
  const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  const soloAsignadas = tipoServicio === 'AUTOSERVICIO';

  const lavadora = cg.lavadora_usada_id
    ? { nombre: 'Lavadora',
        tipo: MAQUINA_TIPO_LABEL[cg.lavadora_usada_tipo] ?? '',
        precio: Number(cg.precio_lavadora) }
    : cg.lavadora_tipo_previsto && !soloAsignadas
      ? { nombre: 'Lavadora',
          tipo: capitalizar(cg.lavadora_tipo_previsto),
          precio: Number(cg.precio_lavadora) }
      : null;

  // La secadora es de un solo tamaño: no lleva calificativo.
  const secadora = (cg.secadora_usada_id || (cg.secadora_tipo_previsto && !soloAsignadas))
    ? { nombre: 'Secadora', tipo: '', precio: Number(cg.precio_secadora) }
    : null;

  return [lavadora, secadora].filter(Boolean);
}

// ¿Esta carga tiene algo que enseñarle al cliente? Una carga sin máquina, sin
// productos y sin precio no debe aparecer en el ticket: el cliente vería una
// "Carga 2 · $0.00" que no existió. Se conserva si tiene máquina (puesta o solo
// elegida), productos o un precio que cobrar.
//
// POR ENCARGO es la excepción: ahí el ticket lista SERVICIOS, no máquinas, y el
// cliente paga por el servicio venga en una máquina o en tres. Una máquina que
// el mostrador agregó en Salidas —una secadora que abre su propio renglón— no
// cobra nada, y listarla imprimiría un "SERVICIO POR ENCARGO · $0.00" que el
// cliente no compró. Por eso ahí solo se enseña lo que cuesta algo.
export function cargaVisibleEnTicket(cg, tipoServicio) {
  const tieneProductos = (cg.productos ?? []).some(p => p.unidad !== 'tapa');
  // El precio del servicio Por Encargo llega de la API como `tope_carga`
  // (`nota_cargas.precio_tope` renombrado en el SELECT). Mirar solo
  // `precio_tope` dejaba fuera del ticket al servicio Chico o Grande, que no
  // cobra máquinas ni lleva productos: su única línea es su precio.
  const cobraAlgo      = Number(cg.tope_carga ?? cg.precio_tope ?? 0) > 0
    || Number(cg.precio_lavadora ?? 0) > 0
    || Number(cg.precio_secadora ?? 0) > 0
    || Number(cg.ajuste ?? 0) !== 0;
  if (tipoServicio === 'POR_ENCARGO') return tieneProductos || cobraAlgo;
  const tieneMaquinas  = maquinasDeCarga(cg, tipoServicio).length > 0;
  return tieneMaquinas || tieneProductos || cobraAlgo;
}

