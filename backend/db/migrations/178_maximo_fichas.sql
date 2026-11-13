-- Migración 178: máximo de fichas por arranque, por modelo
-- Fecha: 2026-11-12
--
-- "¿Cuántas fichas?" al iniciar una máquina de fichas ofrecía siempre 1, 2 o 3.
-- Ahora cada modelo dice hasta cuántas (Ajustes, junto a su precio); 3 por
-- omisión. A pedido de la usuaria el Maytag1 (S1 de Zapopan) llega hasta 2.

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS max_fichas INTEGER NOT NULL DEFAULT 3;

ALTER TABLE modelos_maquina
  DROP CONSTRAINT IF EXISTS modelos_maquina_max_fichas_rango,
  ADD  CONSTRAINT modelos_maquina_max_fichas_rango CHECK (max_fichas BETWEEN 1 AND 3);

UPDATE modelos_maquina mo
   SET max_fichas = 2
  FROM marcas_maquina mm
 WHERE mm.id = mo.marca_id
   AND LOWER(TRIM(mm.nombre)) = 'maytag'
   AND LOWER(TRIM(mo.nombre)) = 'maytag1';

COMMIT;
