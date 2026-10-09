// Cierre de la PASADA en curso de una máquina (migs. 114, 140 y 141).
//
// Cada uso de una máquina en una carga es una fila de `nota_carga_maquinas`
// con su arranque (`encendida_at`) y su fin (`finalizada_at`). Los botones de
// Finalizar la cierran con `sellarFinDePasada` (notas.controller.js), pero
// hay otros caminos que sueltan una máquina en marcha: el barrido de
// medianoche, pasar la nota a Por Entregar o cancelarla, Detener ciclo, y
// arrancar la secadora de una carga cuya lavadora seguía en uso. Sin esto esa
// pasada se quedaba sin hora de inicio ni de fin, y el ciclo salía sin horario
// ni tiempo encendida en Desempeño, Ventas e Información de uso (2026-10-09).
//
// Se llama ANTES de soltar la máquina, mientras la carga todavía la tiene en
// su hueco y `en_uso_desde` conserva el arranque. Solo toca la última pasada
// del hueco, sin cerrar, de una carga que de verdad arrancó esa máquina. Misma
// regla de fin que Finalizar: con cronómetro el reloj se para en el tope.

import { esCronometroSql, TOPE_RELOJ } from './sqlMaquina.js';

export async function sellarPasadasVivas(client, maquinaIds) {
  const ids = (maquinaIds ?? []).map(Number).filter(Number.isInteger);
  if (ids.length === 0) return;
  await client.query(
    `UPDATE nota_carga_maquinas ncm
        SET encendida_at  = t.inicio,
            llego_tope    = COALESCE(t.inicio + t.tope <= NOW(), FALSE),
            finalizada_at = CASE WHEN t.inicio + t.tope <= NOW()
                                 THEN t.inicio + t.tope ELSE NOW() END
       FROM (
         SELECT x.id AS pasada_id,
                COALESCE(m.en_uso_desde,
                  CASE WHEN x.slot = 'lavadora' THEN nc.lavadora_iniciada_at
                       ELSE nc.secadora_iniciada_at END) AS inicio,
                CASE WHEN ${esCronometroSql('m')} AND m.ciclo_minutos > 0
                     THEN make_interval(mins => ${TOPE_RELOJ('m')}) END AS tope
           FROM nota_carga_maquinas x
           JOIN nota_cargas nc ON nc.id = x.carga_id
           JOIN maquinas m     ON m.id = x.maquina_id
          WHERE m.id = ANY($1)
            AND m.estado = 'en_uso'
            AND x.finalizada_at IS NULL
            -- La carga sigue teniendo esta máquina en el hueco y la arrancó
            -- ella (asignar no aparta: otra nota puede tenerla sin usarla).
            AND (CASE WHEN x.slot = 'lavadora' THEN nc.lavadora_id ELSE nc.secadora_id END) = m.id
            AND (CASE WHEN x.slot = 'lavadora' THEN nc.lavadora_iniciada_at
                      ELSE nc.secadora_iniciada_at END) IS NOT NULL
            -- Solo la última pasada de su hueco.
            AND x.id = (
              SELECT y.id FROM nota_carga_maquinas y
               WHERE y.carga_id = x.carga_id AND y.slot = x.slot
               ORDER BY y.asignada_at DESC, y.id DESC LIMIT 1
            )
       ) t
      WHERE ncm.id = t.pasada_id
        AND t.inicio IS NOT NULL`,
    [ids]
  );
}
