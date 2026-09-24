// Fragmentos de SQL sobre `maquinas` que usan varios controladores.
//
// Viven aquí y no copiados en cada consulta porque son reglas, no detalles de
// una pantalla: si cambian, tienen que cambiar en todas a la vez.

// Los minutos de ciclo CONFIGURADOS para ESTA máquina, o NULL si nadie los ha
// medido. Se resuelven en cadena, del dato más específico al más general:
//
//   1. su MODELO, si tiene uno con minutos propios (mig. 117). Un modelo puede
//      llevar hasta TRES tiempos (mig. 120) y entonces manda **el último con
//      valor**, que es el más largo: quedarse corto le corta la corriente a
//      media carga. Si el modelo pregunta al iniciar, lo elegido se escribe
//      encima de esto al sellar el ciclo;
//   2. su MARCA para su tipo y tamaño (mig. 107);
//   3. NULL → la máquina se cronometra con el respaldo por tamaño de Ajustes,
//      que es un tiempo supuesto y no medido.
//
// El escalón del modelo va primero porque es el que sabe de verdad cuánto
// tarda el aparato; el de la marca no se puede quitar, porque hoy ninguna
// máquina tiene modelo capturado y sin él las LG se cronometrarían cortas
// (que es justo el bug que arregló la mig. 107).
//
// Tanto la marca como el modelo se alcanzan por NOMBRE y no por id (migs. 106
// y 117): es lo que guarda la máquina.
//
// Se interpola en consultas donde la tabla `maquinas` va con el alias `m`, y
// no lleva parámetros: es una subconsulta correlacionada, no una plantilla con
// valores del usuario.
export const MINUTOS_CONFIGURADOS = `COALESCE(
  (
    SELECT COALESCE(mo.minutos_3, mo.minutos_2, mo.minutos)
      FROM marcas_maquina mm
      JOIN modelos_maquina mo ON mo.marca_id = mm.id
     WHERE mm.nombre = m.marca
       AND mo.nombre = m.modelo
       AND COALESCE(mo.minutos_3, mo.minutos_2, mo.minutos) IS NOT NULL
  ),
  (
    SELECT tm.minutos
      FROM marcas_maquina mm
      JOIN tiempos_marca tm ON tm.marca_id = mm.id
     WHERE mm.nombre = m.marca
       AND tm.tipo = CASE WHEN m.tipo = 'secadora' THEN 'secadora' ELSE 'lavadora' END
       AND tm.tamano = m.tamano
  )
)`;

// Los tiempos que ofrece el modelo de ESTA máquina y si hay que preguntar cuál
// usar (mig. 120). Va como objeto porque las dos cosas se leen juntas: la
// pantalla pregunta solo si el interruptor está encendido y hay más de uno.
// Mismo alias `m` y mismas reglas que MINUTOS_CONFIGURADOS.
export const TIEMPOS_DEL_MODELO = `(
  SELECT json_build_object(
           'pregunta', mo.pregunta_tiempo,
           'minutos',  ARRAY_REMOVE(ARRAY[mo.minutos, mo.minutos_2, mo.minutos_3], NULL)
         )
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;
