// Fragmentos de SQL sobre `maquinas` que usan varios controladores.
//
// Viven aquí y no copiados en cada consulta porque son reglas, no detalles de
// una pantalla: si cambian, tienen que cambiar en todas a la vez.

// Los minutos de ciclo CONFIGURADOS para ESTA máquina, o NULL si nadie los ha
// medido. Se resuelven en cadena, del dato más específico al más general:
//
//   1. su MODELO, si tiene uno con minutos propios (mig. 117). Es su campo
//      grande, `minutos`; en el modelo que pregunta su programa ese campo es
//      el TOPE y los programas van aparte (mig. 146, ver MINUTOS_DEL_MODELO);
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
// Los minutos que manda un modelo (alias de `modelos_maquina` que se pase): su
// campo grande y, si no lo capturaron, el más largo de sus programas —quedarse
// corto le cortaría la corriente a media carga—. GREATEST ignora los NULL.
export const MINUTOS_DEL_MODELO = (mo) =>
  `COALESCE(${mo}.minutos, GREATEST(${mo}.minutos_2, ${mo}.minutos_3, ${mo}.minutos_4))`;

// Los programas que ofrece el modelo que pregunta (mig. 146): los tres campos
// chicos de "Otros tiempos".
export const PROGRAMAS_DEL_MODELO = (mo) =>
  `ARRAY_REMOVE(ARRAY[${mo}.minutos_2, ${mo}.minutos_3, ${mo}.minutos_4], NULL)`;

export const MINUTOS_CONFIGURADOS = `COALESCE(
  (
    SELECT ${MINUTOS_DEL_MODELO('mo')}
      FROM marcas_maquina mm
      JOIN modelos_maquina mo ON mo.marca_id = mm.id
     WHERE mm.nombre = m.marca
       AND mo.nombre = m.modelo
       AND ${MINUTOS_DEL_MODELO('mo')} IS NOT NULL
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
// negocio lo extendió a TODAS, lavadoras y secadoras. Hasta el 2026-10-04 el
// modelo que PREGUNTA su tiempo (la secadora Speed Queen Sec49, mig. 120) se
// quedaba con temporizador; desde la mig. 146 también va con cronómetro: su
// programa elegido avisa cuándo terminó y su campo grande es el tope.
//
// Interruptor general: `MAQUINAS_CRONOMETRO=off` en el servidor devuelve TODAS
// las máquinas al temporizador sin tocar código (ver
// info/Temporizador/Máquinas - flujo con temporizador.md). Se lee en cada
// llamada para que las pruebas del temporizador lo puedan apagar.
export const cronometroActivo = () =>
  String(process.env.MAQUINAS_CRONOMETRO ?? '').toLowerCase() !== 'off';

// La regla en SQL, para la fila de `maquinas` con el alias que se pase. Hoy
// son todas o ninguna; se deja como función para no tocar sus usos si vuelve a
// haber excepciones.
export const esCronometroSql = () => (cronometroActivo() ? 'TRUE' : 'FALSE');

// Cronómetro CON botón Iniciar (a pedido del negocio). Son de
// cronómetro —cuenta hacia arriba, los minutos de su modelo son su TOPE y la
// carga termina cuando alguien la finaliza— pero no llevan "Encender máquina":
// su único botón es "Iniciar", que les da corriente y arranca el cronómetro en
// el mismo paso (2026-10-04; antes iban en dos pasos, como la espera de la mig. 110):
//   · todas las Speed Queen, lavadoras y secadoras;
//   · el modelo que pregunta su programa (mig. 146), sea de la marca que sea:
//     la pregunta sale al iniciar, cuando ya la están programando.
export const MARCA_CON_INICIAR = 'speed queen';

export const conIniciarSql = (alias) => (cronometroActivo() ? `(
  COALESCE(LOWER(TRIM(${alias}.marca)), '') = '${MARCA_CON_INICIAR}'
  OR EXISTS (
    SELECT 1
      FROM marcas_maquina mmc
      JOIN modelos_maquina moc ON moc.marca_id = mmc.id
     WHERE mmc.nombre = ${alias}.marca
       AND moc.nombre = ${alias}.modelo
       AND moc.pregunta_tiempo
       AND cardinality(${PROGRAMAS_DEL_MODELO('moc')}) > 1
  )
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

// Los programas que ofrece el modelo de ESTA máquina y si hay que preguntar
// cuál usar (migs. 120 y 146). Va como objeto porque las dos cosas se leen
// juntas: la pantalla pregunta solo si el interruptor está encendido y hay más
// de uno.
// Mismo alias `m` y mismas reglas que MINUTOS_CONFIGURADOS.
export const TIEMPOS_DEL_MODELO = `(
  SELECT json_build_object(
           'pregunta', mo.pregunta_tiempo,
           'minutos',  ${PROGRAMAS_DEL_MODELO('mo')}
         )
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;
