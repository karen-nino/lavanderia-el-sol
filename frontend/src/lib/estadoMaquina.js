// Estado que se le enseña a una máquina en Gestión de Máquinas.
//
// "Reservada" no es un estado de la tabla `maquinas`: es una máquina
// `disponible` que ya tiene asignada una carga de otra nota abierta. El backend
// lo calcula y lo manda en `reservada` (no bloquea nada —se la queda quien
// arranque primero— pero avisa de que alguien más va por ella).
//
// Vive aquí y no dentro de la página para poder probarlo: el chip de filtro
// cuenta y filtra con esto.
export const estadoVisual = (m) => (m.reservada ? 'reservada' : m.estado);

// Cuántas máquinas hay en cada estado visible, para los chips de filtro.
export const contarPorEstado = (maquinas, estados) =>
  Object.fromEntries(estados.map(e => [e, maquinas.filter(m => estadoVisual(m) === e).length]));

// Las que muestra el filtro activo. 'todos' no filtra nada.
export const filtrarPorEstado = (maquinas, filtro) =>
  filtro === 'todos' ? maquinas : maquinas.filter(m => estadoVisual(m) === filtro);

// "Marca · Tamaño" de una máquina, como se lista al agregarla a una nota
// ("LG · Mediana", "Speed Queen · Jumbo"). El tamaño sale de la columna
// `tamano` (lavadoras y, desde la mig. 051, también secadoras) y, si falta, del
// tipo de la lavadora. Lo que no se sepa se omite; sin nada, null.
const TAMANO_POR_TIPO = { lavadora_mediana: 'mediana', lavadora_jumbo: 'jumbo' };
export const marcaYTamano = (m) => {
  const marca = String(m?.marca ?? '').trim();
  const t = String(m?.tamano ?? TAMANO_POR_TIPO[m?.tipo] ?? '').trim();
  const tamano = t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
  return [marca, tamano].filter(Boolean).join(' · ') || null;
};
