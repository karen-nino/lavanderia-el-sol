-- Migración 030: separar tipo de prenda del tipo de servicio
-- Fecha: 2026-06-16
--
-- modalidad se mantiene como el "tipo de servicio" (AUTOSERVICIO / POR_ENCARGO)
-- y tipo_prenda guarda si la nota es de Ropa o Edredón. Antes la modalidad
-- EDREDON mezclaba ambos conceptos y dificultaba los reportes por servicio.
--
-- La modalidad legacy EDREDON queda en el enum por compatibilidad histórica,
-- pero ya no se usa para notas nuevas.

BEGIN;

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS tipo_prenda VARCHAR(10);

-- Backfill: si la nota era modalidad=EDREDON, su prenda era Edredón.
-- (Para asignar la modalidad correcta se asume que si tenía cliente_id
--  era encargo, si no, era autoservicio.)
UPDATE notas
  SET tipo_prenda = 'EDREDON',
      modalidad   = CASE
        WHEN cliente_id IS NOT NULL THEN 'POR_ENCARGO'::modalidad_orden
        ELSE 'AUTOSERVICIO'::modalidad_orden
      END
  WHERE modalidad = 'EDREDON';

UPDATE notas
  SET tipo_prenda = 'ROPA'
  WHERE tipo_prenda IS NULL;

ALTER TABLE notas
  ALTER COLUMN tipo_prenda SET NOT NULL;

ALTER TABLE notas
  ADD CONSTRAINT notas_tipo_prenda_check
  CHECK (tipo_prenda IN ('ROPA', 'EDREDON'));

CREATE INDEX IF NOT EXISTS idx_notas_tipo_prenda ON notas(tipo_prenda);

COMMIT;
