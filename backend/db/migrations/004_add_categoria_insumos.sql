BEGIN;

ALTER TABLE insumos
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) NULL;

CREATE INDEX IF NOT EXISTS idx_insumos_categoria ON insumos(categoria);

COMMIT;
