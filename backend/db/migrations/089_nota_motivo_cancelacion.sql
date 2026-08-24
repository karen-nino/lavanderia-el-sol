-- Migración 089: motivo de cancelación de una nota
-- ============================================================
-- Al cancelar una nota se puede capturar por qué se canceló. Se guarda en la
-- nota para consultarlo después (y se incluye en la alerta de cancelación).

ALTER TABLE notas ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;
