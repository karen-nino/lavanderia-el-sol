/** Qué botones ofrece el detalle de una nota (estado de la nota × estado del pago). */

/** Una nota terminada solo se mira (borrar va aparte, es de admin). */
export const esTerminal = (nota) => ['FINALIZADA', 'CANCELADA'].includes(nota?.estado);

/**
 * Autoservicio con máquina por asignar: la carga aún vale $0 (se tarifa al
 * asignar en Salidas), así que no se cobra (el servidor responde 409).
 */
export const faltaAsignarMaquina = (nota) =>
  nota?.tipo_servicio === 'AUTOSERVICIO'
  && (nota?.cargas ?? []).some(cg =>
       (cg.lavadora_tipo_previsto && !cg.lavadora_usada_id)
       || (cg.secadora_tipo_previsto && !cg.secadora_usada_id));

/**
 * Cobrar se puede desde que la nota existe (en Por Encargo se suele pagar al
 * dejar la ropa) y en cualquier estado salvo CANCELADA, como el servidor. En
 * FINALIZADA solo registra el pago (p. ej. tras revertirlo).
 */
export const puedeLiquidar = (nota) =>
  nota?.estado_pago === 'PENDIENTE' && nota?.estado !== 'CANCELADA'
  && !faltaAsignarMaquina(nota);

/** Finalizar (la ropa se entregó) exige que ya esté cobrada. */
export const puedeFinalizar = (nota) =>
  !esTerminal(nota) && nota?.estado === 'LISTA' && nota?.estado_pago !== 'PENDIENTE';

/**
 * Borrar es de admin, en cualquier estado, salvo con el cobro congelado en un
 * corte cerrado (`cobro_congelado`: el servidor responde 409).
 */
export const puedeEliminar = (nota, esAdmin) =>
  Boolean(esAdmin) && !nota?.cobro_congelado;

/**
 * En pantallas táctiles el botón de borrar solo se muestra en notas cerradas:
 * con la nota viva el camino es cancelar. La página lo aplica con
 * `pointer-fine` (mouse o trackpad), no por ancho.
 */
export const eliminarSoloEnEscritorio = (nota) => !esTerminal(nota);
