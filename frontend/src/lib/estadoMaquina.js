/**
 * Estado que se muestra en Gestión de Máquinas. "Reservada" no es un estado de
 * la tabla: es una disponible con una carga de otra nota abierta (`reservada`,
 * del backend). No bloquea: se la queda quien arranque primero.
 */
export const estadoVisual = (m) => (m.reservada ? 'reservada' : m.estado);

// Cuántas máquinas hay en cada estado visible, para los chips de filtro.
export const contarPorEstado = (maquinas, estados) =>
  Object.fromEntries(estados.map(e => [e, maquinas.filter(m => estadoVisual(m) === e).length]));

// Las que muestra el filtro activo. 'todos' no filtra nada.
export const filtrarPorEstado = (maquinas, filtro) =>
  filtro === 'todos' ? maquinas : maquinas.filter(m => estadoVisual(m) === filtro);

/**
 * "Marca · Tamaño" ("LG · Mediana"). El tamaño sale de `tamano` o, si falta, del
 * tipo de lavadora; lo que no se sepa se omite y sin nada, null.
 */
const TAMANO_POR_TIPO = { lavadora_mediana: 'mediana', lavadora_jumbo: 'jumbo' };
export const marcaYTamano = (m) => {
  const marca = String(m?.marca ?? '').trim();
  const t = String(m?.tamano ?? TAMANO_POR_TIPO[m?.tipo] ?? '').trim();
  const tamano = t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
  return [marca, tamano].filter(Boolean).join(' · ') || null;
};
