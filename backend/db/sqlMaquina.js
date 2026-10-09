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

// Dónde se para el reloj de una máquina con cronómetro (alias que se pase): su
// tope, `ciclo_minutos`. Excepción: a la secadora de monedas que recibió
// "Otro ciclo" (mig. 148, `minutos_pagados` con valor) nunca se le corta la
// luz, y si el empleado tardó en sumarle puede secar más allá del tope; ahí el
// reloj llega hasta que se le acaba el tiempo (`ciclo_elegido_minutos`).
export const TOPE_RELOJ = (a) => `(CASE WHEN ${a}.minutos_pagados IS NOT NULL
  THEN GREATEST(${a}.ciclo_minutos, COALESCE(${a}.ciclo_elegido_minutos, 0))
  ELSE ${a}.ciclo_minutos END)`;

// Minutos que da cada moneda en las secadoras de monedas (mig. 147), o NULL
// si la máquina es normal. Con valor, su Sonoff no da corriente: cada pulso es
// una moneda (ver `sincronizarSonoff`). Mismo alias `m` que
// MINUTOS_CONFIGURADOS.
export const MINUTOS_POR_MONEDA = `(
  SELECT mo.minutos_por_moneda
    FROM marcas_maquina mm
    JOIN modelos_maquina mo ON mo.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND mo.nombre = m.modelo
)`;

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

// Los CICLOS de una o varias notas: una fila por PASADA de una máquina
// (mig. 114) que de verdad arrancó, con lo que vale, a qué hora arrancó y
// terminó y cuánto estuvo encendida (migs. 140-141). Lo usan el desempeño del
// empleado y Ventas, y sigue las mismas reglas que Información de uso:
//   · precio: lo cobrado a ese hueco en su primera pasada; si no se cobró
//     aparte (Por Encargo, con precio de servicio) o es una vuelta más, la
//     tarifa de la máquina en Ajustes;
//   · la pasada que sigue corriendo toma el arranque de la máquina y, si ya
//     pasó su tope, el reloj se paró ahí.
// `filtro` es una condición SQL sobre `n` (la nota), p. ej. 'n.id = o.id' o
// 'n.usuario_id = $1'. Sin ORDER BY: lo pone quien la usa (carga_orden,
// asignada_at, pasada_id).
export const CICLOS_DE_PASADAS = (filtro) => `SELECT nc.nota_id, nc.orden AS carga_orden, p.id AS pasada_id, p.asignada_at,
              p.maquina_nombre,
              -- Lo que vale el ciclo en ESA máquina, con la misma regla que
              -- Información de uso: lo cobrado a ese hueco en su primera
              -- pasada; si no se cobró aparte (Por Encargo, con precio de
              -- servicio) o es una vuelta más, la tarifa de la máquina en
              -- Ajustes. Manda el tipo congelado en la pasada; sin él, el de la máquina.
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
                  -- Solo la última pasada de su hueco puede estar corriendo.
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
