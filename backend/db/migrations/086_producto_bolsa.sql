-- Migración 086: bolsas como un tipo de artículo del inventario
-- ============================================================
-- Además de los líquidos (granel/marca), el inventario maneja BOLSAS: se compran
-- por rollo (cada rollo trae N bolsas), se cuentan en piezas y se cobran en la
-- nota según el tamaño de la carga. Se modelan como productos con clase='bolsa'.
--   • clase            → 'liquido' (default, granel/marca) o 'bolsa'
--   • tamano_bolsa     → 'chica' | 'grande' | 'jumbo'
--   • bolsas_por_rollo → cuántas bolsas trae un rollo (para las entradas)
-- Para las bolsas: precio_unitario = precio por pieza; stock_actual/stock_minimo
-- se interpretan en piezas (bolsas).

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS clase            TEXT NOT NULL DEFAULT 'liquido',
  ADD COLUMN IF NOT EXISTS tamano_bolsa     TEXT,
  ADD COLUMN IF NOT EXISTS bolsas_por_rollo INTEGER;

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_clase_chk;
ALTER TABLE productos ADD CONSTRAINT productos_clase_chk
  CHECK (clase IN ('liquido', 'bolsa'));

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_tamano_bolsa_chk;
ALTER TABLE productos ADD CONSTRAINT productos_tamano_bolsa_chk
  CHECK (tamano_bolsa IS NULL OR tamano_bolsa IN ('chica', 'grande', 'jumbo'));

-- El historial de movimientos ahora puede impactar la existencia de piezas.
ALTER TABLE producto_movimientos DROP CONSTRAINT IF EXISTS producto_movimientos_destino_check;
ALTER TABLE producto_movimientos ADD CONSTRAINT producto_movimientos_destino_check
  CHECK (destino IN ('granel', 'botellas', 'piezas'));
