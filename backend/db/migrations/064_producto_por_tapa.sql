-- Migración 064: productos líquidos consumidos por "tapa/medida"
-- ============================================================
-- Algunos productos (jabón, suavizante, cloro) se COMPRAN por envase
-- (caja/cubeta) pero se CONSUMEN por tapa medidora. Una pieza/envase rinde
-- muchas tapas. Para estos productos el stock (stock_actual/stock_reservado)
-- se interpreta en TAPAS, precio_unitario = precio por tapa y stock_minimo =
-- umbral de alerta en tapas.
--   • es_por_tapa      → marca el producto como "por tapa/medida"
--   • tapas_por_envase → cuántas tapas rinde un envase (rendimiento)
--   • envase           → nombre del envase para mostrar (cubeta / caja)

ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_por_tapa      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tapas_por_envase INTEGER;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS envase           VARCHAR(50);
