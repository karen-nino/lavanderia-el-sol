-- Migración 171: casilla "Arranca sola al recibir corriente" del modelo
-- Fecha: 2026-11-10
--
-- Hasta hoy solo las Speed Queen (por marca) arrancaban con un botón, "Iniciar",
-- que da corriente y arranca el cronómetro en el mismo paso. La Girbau de
-- Zapopan también empieza a lavar en cuanto recibe corriente: a pedido de la
-- usuaria pasa a ser una casilla del modelo. No va con "Trabaja con fichas: sin
-- Sonoff y sin tiempos" (solo_fichas), que no tiene Sonoff.
-- Se marca el modelo de la marca Girbau.

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS arranca_con_corriente BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE modelos_maquina mo
   SET arranca_con_corriente = TRUE
  FROM marcas_maquina mm
 WHERE mm.id = mo.marca_id AND LOWER(TRIM(mm.nombre)) = 'girbau' AND NOT mo.solo_fichas;

COMMIT;
