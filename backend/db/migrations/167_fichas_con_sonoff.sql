-- Migración 167: casilla "Trabaja con fichas: con Sonoff y con tiempos"
-- Fecha: 2026-10-22
--
-- Hasta hoy, una secadora era de fichas con Sonoff si alguien le capturaba
-- "Cada ficha" en Ajustes (se abría con el enlace "Es de fichas con Sonoff").
-- A pedido de la usuaria pasa a ser una casilla del modelo, como "Varios
-- programas": solo con ella salen "Cada ficha" y "Costo ficha", y solo con ella
-- cuentan (el Sonoff mete fichas, "Más fichas" las cobra). No va con "Trabaja
-- con fichas: sin Sonoff y sin tiempos" (solo_fichas).
-- Se marca la Sec49: secadora con varios programas y "Cada ficha" capturado.

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS fichas_sonoff BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE modelos_maquina
   SET fichas_sonoff = TRUE
 WHERE tipo = 'secadora' AND pregunta_tiempo AND NOT solo_fichas AND minutos_por_ficha IS NOT NULL;

COMMIT;
