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

/** Precio del programa `min` (Ajustes → Precio, para Autoservicio), o null. */
export function precioDePrograma(maquina, min) {
  const { minutos = [], precios = [] } = maquina?.modelo_tiempos ?? {};
  const i = minutos.indexOf(min);
  const p = i >= 0 ? precios?.[i] : null;
  return p == null ? null : Number(p);
}

/** ¿Su modelo cobra por programa? (algún programa con precio). */
export function cobraPorPrograma(maquina) {
  return preguntaTiempo(maquina) && tiemposDeMaquina(maquina).some(min => precioDePrograma(maquina, min) != null);
}

/** Etiqueta de cada programa: "1 min · $20" si se cobra por programa. */
export function etiquetaPrograma(maquina, conPrecio) {
  return (min) => {
    const p = conPrecio ? precioDePrograma(maquina, min) : null;
    if (p == null) return `${min} min`;
    return `${min} min · $${Number.isInteger(p) ? p : p.toFixed(2)}`;
  };
}
