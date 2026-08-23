-- Migración 080: productos líquidos por tipo (granel / marca) y venta por botella
-- ============================================================
-- El mostrador vende líquidos de dos tipos:
--   • granel → se rellenan botellas desde un BIDÓN. Dos existencias:
--       - a granel (bidón)      → stock_granel_tapas
--       - botellas rellenadas   → stock_actual (ya existía; se interpreta en TAPAS)
--   • marca  → se compran ya embotellados. Solo botellas rellenadas (stock_actual).
--
-- Todo el stock se lleva internamente en TAPAS (la unidad más fina) para que las
-- fracciones (una tapa = 1/N de botella) cuadren exacto. Se derivan:
--   tapas_por_botella  = floor(botella_ml / tapa_ml)
--   botellas_por_bidon = floor(volumen_envase_ml / botella_ml)   (volumen_envase_ml = volumen del bidón, en mL)
--
-- Precios: precio_unitario sigue siendo el PRECIO POR TAPA (Por Encargo);
-- precio_botella es el precio de la botella entera (Autoservicio).

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS tipo_liquido       TEXT,
  ADD COLUMN IF NOT EXISTS botella_ml         INTEGER,
  ADD COLUMN IF NOT EXISTS precio_botella     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS stock_granel_tapas INTEGER NOT NULL DEFAULT 0;

-- Los productos existentes (todos "por tapa") se consideran granel.
UPDATE productos
   SET tipo_liquido = 'granel'
 WHERE tipo_liquido IS NULL AND es_por_tapa = true;

-- Restringe los valores válidos (permite NULL para productos no líquidos viejos).
ALTER TABLE productos
  DROP CONSTRAINT IF EXISTS productos_tipo_liquido_chk;
ALTER TABLE productos
  ADD CONSTRAINT productos_tipo_liquido_chk
  CHECK (tipo_liquido IS NULL OR tipo_liquido IN ('granel', 'marca'));
