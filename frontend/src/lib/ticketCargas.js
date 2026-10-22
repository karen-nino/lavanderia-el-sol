// Cómo se listan las cargas en el ticket (aparte para probarlo y para Fast Refresh).

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

/**
 * Máquinas que cobra la carga, por tipo ("Lavadora · Mediana"), no por máquina
 * física. El tamaño, de la máquina asignada o del tipo elegido. En Autoservicio
 * solo con máquina asignada: antes no tiene precio.
 */
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

  // Las fichas de más que se cobraron (secadora de fichas en Autoservicio).
  const fichas = Number(cg.precio_fichas_extra ?? 0) > 0
    ? { nombre: Number(cg.fichas_extra) === 1 ? 'Ficha extra' : 'Fichas extra',
        tipo: '', cantidad: Number(cg.fichas_extra) || 1, precio: Number(cg.precio_fichas_extra) }
    : null;

  return [lavadora, secadora, fichas].filter(Boolean);
}

/**
 * ¿La carga tiene algo que mostrar? Sí si tiene máquina (puesta o elegida),
 * productos o precio. En Por Encargo solo lo que cobra algo: el ticket lista
 * servicios, y una secadora agregada en Salidas no cobra.
 */
export function cargaVisibleEnTicket(cg, tipoServicio) {
  const tieneProductos = (cg.productos ?? []).some(p => p.unidad !== 'medida');
  // El precio del servicio llega como `tope_carga` (precio_tope renombrado).
  const cobraAlgo      = Number(cg.tope_carga ?? cg.precio_tope ?? 0) > 0
    || Number(cg.precio_lavadora ?? 0) > 0
    || Number(cg.precio_secadora ?? 0) > 0
    || Number(cg.precio_fichas_extra ?? 0) > 0
    || Number(cg.ajuste ?? 0) !== 0;
  if (tipoServicio === 'POR_ENCARGO') return tieneProductos || cobraAlgo;
  const tieneMaquinas  = maquinasDeCarga(cg, tipoServicio).length > 0;
  return tieneMaquinas || tieneProductos || cobraAlgo;
}

