-- Migración 146: el modelo que pregunta su tiempo lleva TOPE + tres programas
-- Fecha: 2026-10-04
--
-- Hasta ahora un modelo con `pregunta_tiempo` (la secadora Speed Queen Sec49,
-- mig. 120) ofrecía tres tiempos —`minutos`, `minutos_2`, `minutos_3`— y el
-- elegido era lo que duraba el ciclo: a esa hora se le cortaba la luz. Por eso
-- era la única máquina que no iba con cronómetro.
--
-- El negocio la quiere con cronómetro como las demás (2026-10-04):
--   · `minutos` (el campo grande de Ajustes) pasa a ser su TOPE: a esa hora se
--     le corta la luz si nadie la finalizó, igual que a cualquier máquina;
--   · los TRES programas a elegir van en `minutos_2`, `minutos_3` y el nuevo
--     `minutos_4` (los tres campos chicos de "Otros tiempos").
-- Al iniciarla se pregunta el programa; al cumplirlo se avisa que terminó y hay
-- que finalizarla, y el corte llega hasta el tope.
--
-- Los modelos que ya preguntaban se recorren un lugar: sus tres tiempos pasan a
-- ser los programas y el tope arranca en el más largo de ellos —lo que hoy
-- dura su carga más larga—, para que nada se corte antes que ayer. El tope de
-- verdad lo captura la usuaria en Ajustes.
--
-- `maquinas.ciclo_elegido_minutos` guarda el programa elegido de la carga en
-- curso, aparte de `ciclo_minutos` (el tope): son dos relojes distintos.

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS minutos_4 INTEGER CHECK (minutos_4 > 0);

UPDATE modelos_maquina
   SET minutos_4 = minutos_3,
       minutos_3 = minutos_2,
       minutos_2 = minutos,
       minutos   = GREATEST(minutos, minutos_2, minutos_3)
 WHERE pregunta_tiempo
   AND minutos_4 IS NULL;

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS ciclo_elegido_minutos INTEGER CHECK (ciclo_elegido_minutos > 0);

COMMIT;
