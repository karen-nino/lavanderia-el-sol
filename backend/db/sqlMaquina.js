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

// Máquinas que corren con CRONÓMETRO en vez de temporizador.
//
// Al encenderlas empieza a contar hacia ARRIBA, el empleado las arranca con su
// botón y la carga termina cuando alguien la finaliza; un solo ciclo. Los
// minutos de su modelo o de su tamaño dejan de ser "lo que dura" y pasan a ser
// su TOPE: si nadie la finaliza, al cumplirse se le corta la luz y se avisa.
//
// Se probó primero con las lavadoras LG y Samsung (mig. 137) y el 2026-10-02 el
// negocio lo extendió a TODAS, lavadoras y secadoras. La única excepción es el
// modelo que PREGUNTA su tiempo al iniciar (la secadora Speed Queen Sec49, mig.
// 120): ahí el empleado elige el programa en la pantalla de la máquina y ese
// tiempo sí es su duración, así que conserva su temporizador.
//
// Interruptor general: `MAQUINAS_CRONOMETRO=off` en el servidor devuelve TODAS
// las máquinas al temporizador sin tocar código (ver
// info/Temporizador/Máquinas - flujo con temporizador.md). Se lee en cada
// llamada para que las pruebas del temporizador lo puedan apagar.
export const cronometroActivo = () =>
  String(process.env.MAQUINAS_CRONOMETRO ?? '').toLowerCase() !== 'off';

// La regla en SQL, para la fila de `maquinas` con el alias que se pase. El
// modelo que pregunta su tiempo solo cuenta como tal si de verdad tiene más de
// uno que ofrecer: con uno solo, preguntar no tiene sentido (lib/tiemposModelo).
export const esCronometroSql = (alias) => (cronometroActivo() ? `NOT EXISTS (
  SELECT 1
    FROM marcas_maquina mmc
    JOIN modelos_maquina moc ON moc.marca_id = mmc.id
   WHERE mmc.nombre = ${alias}.marca
     AND moc.nombre = ${alias}.modelo
     AND moc.pregunta_tiempo
     AND cardinality(ARRAY_REMOVE(ARRAY[moc.minutos, moc.minutos_2, moc.minutos_3], NULL)) > 1
)` : 'FALSE');

// Cronómetro CON botón Iniciar: las LAVADORAS Speed Queen (2026-10-04, a
// pedido del negocio). Son de cronómetro —cuenta hacia arriba, los minutos de
// su modelo son su TOPE y la carga termina cuando alguien la finaliza— pero
// "Encender máquina" solo les da corriente y el cronómetro arranca con
// "Iniciar Lavado", igual que el paso de espera de la mig. 110 (si nadie la
// inicia, se apaga a los ESPERA_ARRANQUE_MINUTOS). Sus secadoras no: arrancan
// al encender como las demás.
export const MARCA_LAVADORA_CON_INICIAR = 'speed queen';

export const conIniciarSql = (alias) => (cronometroActivo() ? `(
  COALESCE(LOWER(TRIM(${alias}.marca)), '') = '${MARCA_LAVADORA_CON_INICIAR}' AND ${alias}.tipo <> 'secadora'
)` : 'FALSE');

// Cómo se comporta esta máquina, según su catálogo:
//   · `dos_ciclos` lo declara el MODELO (mig. 123): una carga corre DOS vueltas
//     en ese aparato. Sin modelo capturado va en FALSE y la carga corre una
//     sola, que es lo normal.
// Mismo alias `m` que MINUTOS_CONFIGURADOS.
export const OPCIONES_DE_MARCA = `(
  SELECT json_build_object(
           'dos_ciclos', COALESCE((
             SELECT mo.dos_ciclos
               FROM modelos_maquina mo
              WHERE mo.marca_id = mm.id AND mo.nombre = m.modelo
           ), FALSE)
         )
    FROM marcas_maquina mm
   WHERE mm.nombre = m.marca
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
