// Los tiempos que ofrece el modelo de una máquina y si hay que preguntar cuál
// usar al arrancarla (mig. 120). El backend manda `modelo_tiempos` con la
// máquina; esto es el único lugar donde se decide si el modal sale.
//
// Con un solo tiempo no se pregunta aunque el interruptor esté encendido: no
// hay nada que elegir.
export function tiemposDeMaquina(maquina) {
  const lista = maquina?.modelo_tiempos?.minutos ?? [];
  return lista.filter(n => Number.isInteger(n) && n > 0);
}

export function preguntaTiempo(maquina) {
  return Boolean(maquina?.modelo_tiempos?.pregunta) && tiemposDeMaquina(maquina).length > 1;
}
