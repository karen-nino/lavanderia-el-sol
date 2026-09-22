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
