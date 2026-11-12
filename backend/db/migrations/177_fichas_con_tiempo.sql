-- Migración 177: casilla "Trabaja con fichas: sin Sonoff y con tiempos"
-- Fecha: 2026-11-12
--
-- Como "sin Sonoff y sin tiempos" (solo_fichas): la app no la enciende ni la
-- apaga, arranca con "Iniciar" y pide cuántas fichas lleva. La diferencia: tiene
-- tope = fichas × "Cada ficha" (modelos_maquina.minutos_por_ficha) y al llegar
-- se finaliza sola. Las dos casillas se excluyen. A pedido de la usuaria se
-- marca el Maytag1 (secadora grande de Zapopan).

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS fichas_con_tiempo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE modelos_maquina mo
   SET fichas_con_tiempo = TRUE,
       solo_fichas = FALSE,
       pregunta_tiempo = FALSE,
       fichas_sonoff = FALSE,
       arranca_con_corriente = FALSE
  FROM marcas_maquina mm
 WHERE mm.id = mo.marca_id
   AND LOWER(TRIM(mm.nombre)) = 'maytag'
   AND LOWER(TRIM(mo.nombre)) = 'maytag1';

COMMIT;
