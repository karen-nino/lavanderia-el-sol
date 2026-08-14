-- Migración 067: volúmenes para calcular el rendimiento en tapas
-- ============================================================
-- Además de "tapas_por_envase", un producto por tapa puede capturarse por
-- volumen exacto: cuánto trae el envase y de qué tamaño es la tapa. El sistema
-- calcula las tapas (floor(volumen_envase_ml / tapa_ml)) para no hacer cuentas
-- a mano. Ambos valores se guardan en mililitros. Son opcionales: si el usuario
-- captura las tapas directo, quedan en NULL.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS volumen_envase_ml INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tapa_ml           INTEGER;
