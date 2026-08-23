-- Migración 085: unidad de venta y cantidad en tapas en los productos de nota
-- ============================================================
-- El producto se vende en BOTELLAS (Autoservicio) o en TAPAS (Por Encargo). La
-- columna `cantidad` guarda la cantidad en la unidad vendida (y se cobra a
-- `precio_unitario` por esa unidad), pero el STOCK se lleva en tapas, así que
-- `cantidad_tapas` guarda el equivalente para reservar/consumir/devolver.

ALTER TABLE nota_productos
  ADD COLUMN IF NOT EXISTS unidad         TEXT NOT NULL DEFAULT 'tapa',
  ADD COLUMN IF NOT EXISTS cantidad_tapas INTEGER;

-- Las filas existentes estaban en tapas: cantidad_tapas = cantidad.
UPDATE nota_productos SET cantidad_tapas = cantidad WHERE cantidad_tapas IS NULL;

ALTER TABLE nota_productos
  DROP CONSTRAINT IF EXISTS nota_productos_unidad_chk;
ALTER TABLE nota_productos
  ADD CONSTRAINT nota_productos_unidad_chk CHECK (unidad IN ('botella', 'tapa'));
