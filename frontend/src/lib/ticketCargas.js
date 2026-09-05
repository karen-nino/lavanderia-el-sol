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
// haya una. Las máquinas removidas no se cobran, así que no aparecen.
export function maquinasDeCarga(cg) {
  const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

  const lavadora = cg.lavadora_removida ? null
    : cg.lavadora_usada_id
      ? { nombre: 'Lavadora',
          tipo: MAQUINA_TIPO_LABEL[cg.lavadora_usada_tipo] ?? '',
          precio: Number(cg.precio_lavadora) }
      : cg.lavadora_tipo_previsto
        ? { nombre: 'Lavadora',
            tipo: capitalizar(cg.lavadora_tipo_previsto),
            precio: Number(cg.precio_lavadora) }
        : null;

  // La secadora es de un solo tamaño: no lleva calificativo.
  const secadora = cg.secadora_removida ? null
    : (cg.secadora_usada_id || cg.secadora_tipo_previsto)
      ? { nombre: 'Secadora', tipo: '', precio: Number(cg.precio_secadora) }
      : null;

  return [lavadora, secadora].filter(Boolean);
}

// ¿Esta carga tiene algo que enseñarle al cliente? Una carga a la que se le
// quitó la máquina queda sin nada que cobrar (en Salidas se ve tachada); en el
// ticket no debe aparecer, porque el cliente vería una "Carga 2 · $0.00" que no
// existió. Se conserva si aún tiene máquina, productos o un precio que cobrar.
export function cargaVisibleEnTicket(cg) {
  const tieneMaquinas  = maquinasDeCarga(cg).length > 0;
  const tieneProductos = (cg.productos ?? []).some(p => p.unidad !== 'tapa');
  const cobraAlgo      = Number(cg.precio_tope ?? 0) > 0
    || Number(cg.precio_lavadora ?? 0) > 0
    || Number(cg.precio_secadora ?? 0) > 0
    || Number(cg.ajuste ?? 0) !== 0;
  return tieneMaquinas || tieneProductos || cobraAlgo;
}

