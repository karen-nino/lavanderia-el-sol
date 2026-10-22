// Fragmentos de SQL sobre `maquinas` compartidos por varios controladores: son
// reglas y tienen que cambiar en todas las consultas a la vez. Marca y modelo
// se alcanzan por NOMBRE (es lo que guarda la máquina). Los que no reciben alias
// esperan la máquina como `m`.

/**
 * Minutos de un modelo (alias de `modelos_maquina`): su campo grande o, si no
 * lo capturaron, el más largo de sus programas (quedarse corto cortaría la luz
 * a media carga).
 */
export const MINUTOS_DEL_MODELO = (mo) =>
  `COALESCE(${mo}.minutos, GREATEST(${mo}.minutos_2, ${mo}.minutos_3, ${mo}.minutos_4))`;

/** Programas del modelo que pregunta: los campos de "Otros tiempos". */
export const PROGRAMAS_DEL_MODELO = (mo) =>
  `ARRAY_REMOVE(ARRAY[${mo}.minutos_2, ${mo}.minutos_3, ${mo}.minutos_4], NULL)`;

/**
 * Precio de cada programa, alineado con PROGRAMAS_DEL_MODELO (NULL = ese
 * programa se cobra por tamaño).
 */
export const PRECIOS_DE_PROGRAMAS = (mo) => `ARRAY(
  SELECT x.p
    FROM unnest(ARRAY[${mo}.minutos_2, ${mo}.minutos_3, ${mo}.minutos_4],
                ARRAY[${mo}.precio_programa_2, ${mo}.precio_programa_3, ${mo}.precio_programa_4])
         WITH ORDINALITY AS x(mi, p, n)
   WHERE x.mi IS NOT NULL
   ORDER BY x.n
)`;

/**
 * Minutos de ciclo configurados para la máquina `m`, o NULL: los de su modelo
 * (en el que pregunta, es su tope) o, si no, los de su marca para su tipo y
 * tamaño. Con NULL se usa el respaldo por tamaño de Ajustes.
 */
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

/**
 * Todas las máquinas usan CRONÓMETRO: cuenta hacia arriba y la carga termina al
 * finalizarla (un solo ciclo). Sus minutos son el TOPE: al cumplirse sin que
 * nadie la finalice se corta la luz y se avisa.
 *
 * `MAQUINAS_CRONOMETRO=off` las regresa todas al temporizador sin tocar código
 * (ver info/Temporizador/). Se lee en cada llamada para que las pruebas lo apaguen.
 */
export const cronometroActivo = () =>
  String(process.env.MAQUINAS_CRONOMETRO ?? '').toLowerCase() !== 'off';

/** La regla en SQL. Hoy son todas o ninguna; es función por si vuelve a haber excepciones. */
export const esCronometroSql = () => (cronometroActivo() ? 'TRUE' : 'FALSE');

/**
 * Máquinas con cronómetro y un solo botón, "Iniciar", que da corriente y
 * arranca el cronómetro en el mismo paso (sin "Encender"):
 * - todas las Speed Queen;
 * - el modelo que pregunta su programa (se pregunta al iniciar);
 * - el modelo de solo fichas (sin Sonoff: solo arranca el cronómetro).
 */
export const MARCA_CON_INICIAR = 'speed queen';

/**
 * ¿El modelo trabaja solo con fichas? Sin Sonoff ni tiempos: no se enciende, no
 * tiene tope y su cronómetro corre hasta finalizarla.
 */
export const soloFichasSql = (alias) => `COALESCE((
  SELECT mof.solo_fichas
    FROM marcas_maquina mmf
    JOIN modelos_maquina mof ON mof.marca_id = mmf.id
   WHERE mmf.nombre = ${alias}.marca
     AND mof.nombre = ${alias}.modelo
), FALSE)`;

/** SQL: ¿la máquina usa el botón "Iniciar"? (ver MARCA_CON_INICIAR). */
export const conIniciarSql = (alias) => (cronometroActivo() ? `(
  COALESCE(LOWER(TRIM(${alias}.marca)), '') = '${MARCA_CON_INICIAR}'
  OR EXISTS (
    SELECT 1
      FROM marcas_maquina mmc
      JOIN modelos_maquina moc ON moc.marca_id = mmc.id
     WHERE mmc.nombre = ${alias}.marca
       AND moc.nombre = ${alias}.modelo
       AND ((moc.pregunta_tiempo AND cardinality(${PROGRAMAS_DEL_MODELO('moc')}) > 1)
            OR moc.solo_fichas)
  )
)` : 'FALSE');

/**
 * Minuto en que se para el reloj de una máquina con cronómetro: su tope. En la
 * secadora de fichas con "Otro ciclo" (`minutos_pagados`), el fin real, que
 * puede pasar del tope.
 */
export const TOPE_RELOJ = (a) => `(CASE WHEN ${a}.minutos_pagados IS NOT NULL
  THEN GREATEST(${a}.ciclo_minutos, COALESCE(${a}.ciclo_elegido_minutos, 0))
  ELSE ${a}.ciclo_minutos END)`;

/**
 * Minutos por ficha de la secadora de fichas, o NULL. Con valor, cada pulso del
 * Sonoff es una ficha (ver sincronizarSonoff).
 */
export const MINUTOS_POR_FICHA = `(
  SELECT mo.minutos_por_ficha
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;

/** Costo de cada ficha de la secadora de fichas (su modelo), o NULL. */
export const PRECIO_POR_FICHA = `(
  SELECT mo.precio_por_ficha
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;

/** Opciones del modelo de la máquina: `dos_ciclos` (sin modelo, FALSE). */
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

/**
 * { pregunta, minutos }: los programas del modelo y si se pregunta cuál usar
 * (la pantalla pregunta si está activo y hay más de uno).
 */
export const TIEMPOS_DEL_MODELO = `(
  SELECT json_build_object(
           'pregunta', mo.pregunta_tiempo,
           'minutos',  ${PROGRAMAS_DEL_MODELO('mo')},
           'precios',  ${PRECIOS_DE_PROGRAMAS('mo')}
         )
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;

/**
 * Ciclos de una o varias notas: una fila por vuelta que de verdad arrancó, con
 * precio, inicio, fin y segundos (desempeño de empleados y Ventas; mismas reglas
 * que Información de uso):
 * - precio: lo cobrado a ese hueco en su primera vuelta; si no se cobró aparte
 *   o es una vuelta más, la tarifa de la máquina en Ajustes;
 * - la vuelta que sigue corriendo usa el arranque de la máquina y, si ya pasó
 *   su tope, se para ahí.
 *
 * @param {string} filtro condición SQL sobre `n` (la nota). Sin ORDER BY.
 */
export const CICLOS_DE_PASADAS = (filtro) => `SELECT nc.nota_id, nc.orden AS carga_orden, p.id AS pasada_id, p.asignada_at,
              p.maquina_nombre,
              -- Precio de la vuelta (tipo congelado en ella o, si no, el de la máquina).
              CASE WHEN ROW_NUMBER() OVER (PARTITION BY p.carga_id, p.slot
                                           ORDER BY p.asignada_at, p.id) = 1
                        AND (CASE WHEN p.slot = 'lavadora' THEN nc.precio_lavadora
                                  ELSE nc.precio_secadora END) > 0
                   THEN CASE WHEN p.slot = 'lavadora' THEN nc.precio_lavadora
                             ELSE nc.precio_secadora END
                   ELSE CASE
                          WHEN COALESCE(p.maquina_tipo, mx.tipo::text) = 'secadora'
                               AND COALESCE(p.maquina_tamano, mx.tamano::text) = 'jumbo'         THEN aj.precio_secadora_jumbo
                          WHEN COALESCE(p.maquina_tipo, mx.tipo::text) = 'secadora'          THEN aj.precio_carga_secadora
                          WHEN COALESCE(p.maquina_tipo, mx.tipo::text) = 'lavadora_jumbo'    THEN aj.precio_carga_jumbo
                          ELSE aj.precio_carga_mediana
                        END
              END AS precio,
              CASE WHEN p.finalizada_at IS NOT NULL
                   THEN ROUND(EXTRACT(EPOCH FROM p.finalizada_at - p.encendida_at))::int
                   WHEN vivo.al_tope THEN ${TOPE_RELOJ('mx')} * 60
              END AS segundos,
              p.llego_tope OR (p.finalizada_at IS NULL AND vivo.al_tope) AS tope,
              COALESCE(p.encendida_at, CASE WHEN vivo.corriendo THEN mx.en_uso_desde END) AS inicio_at,
              COALESCE(p.finalizada_at,
                       CASE WHEN vivo.al_tope
                            THEN mx.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('mx')}) END) AS fin_at
         FROM nota_carga_maquinas p
         JOIN nota_cargas nc ON nc.id = p.carga_id
         JOIN notas n ON n.id = nc.nota_id
         LEFT JOIN maquinas mx ON mx.id = p.maquina_id
         LEFT JOIN ajustes aj ON aj.id = 1
         CROSS JOIN LATERAL (
           SELECT (CASE WHEN p.slot = 'lavadora' THEN nc.lavadora_id
                        ELSE nc.secadora_id END) IS NOT DISTINCT FROM p.maquina_id
                  AND p.finalizada_at IS NULL
                  -- Solo la última vuelta de su hueco puede estar corriendo.
                  AND p.id = (SELECT x.id FROM nota_carga_maquinas x
                               WHERE x.carga_id = p.carga_id AND x.slot = p.slot
                               ORDER BY x.asignada_at DESC, x.id DESC LIMIT 1) AS corriendo
         ) c0
         CROSS JOIN LATERAL (
           SELECT c0.corriendo,
                  COALESCE(c0.corriendo
                    AND mx.en_uso_desde IS NOT NULL
                    AND mx.ciclo_minutos > 0
                    AND ${esCronometroSql('mx')}
                    AND mx.en_uso_desde + make_interval(mins => ${TOPE_RELOJ('mx')}) <= NOW(),
                  FALSE) AS al_tope
         ) vivo
        WHERE (${filtro})
          AND (p.encendida_at IS NOT NULL
               OR (p.slot = 'lavadora' AND nc.lavadora_iniciada_at IS NOT NULL)
               OR (p.slot = 'secadora' AND nc.secadora_iniciada_at IS NOT NULL))`;
