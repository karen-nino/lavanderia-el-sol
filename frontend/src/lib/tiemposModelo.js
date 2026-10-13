/**
 * Tiempos del modelo de una máquina (`modelo_tiempos`) y si hay que preguntar
 * cuál al arrancar: solo con más de uno.
 */
export function tiemposDeMaquina(maquina) {
  const lista = maquina?.modelo_tiempos?.minutos ?? [];
  return lista.filter(n => Number.isInteger(n) && n > 0);
}

export function preguntaTiempo(maquina) {
  return Boolean(maquina?.modelo_tiempos?.pregunta) && tiemposDeMaquina(maquina).length > 1;
}
