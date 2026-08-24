-- Migración 087: unidad 'pieza' en los productos de nota (para las bolsas)
-- ============================================================
-- Las bolsas se cobran/consumen por pieza. La línea de nota_productos de una
-- bolsa lleva unidad 'pieza' (además de 'botella' y 'tapa' de los líquidos).

ALTER TABLE nota_productos DROP CONSTRAINT IF EXISTS nota_productos_unidad_chk;
ALTER TABLE nota_productos
  ADD CONSTRAINT nota_productos_unidad_chk CHECK (unidad IN ('botella', 'tapa', 'pieza'));
