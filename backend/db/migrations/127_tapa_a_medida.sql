-- Migración 127: "tapa" pasa a llamarse "medida"
-- ============================================================
-- La unidad fina de los líquidos a granel (antes "tapa") ahora se llama
-- "medida" en toda la app: columnas, valores guardados y textos del historial.
-- Las migraciones anteriores conservan los nombres viejos; esta los renombra.

-- Columnas
ALTER TABLE productos            RENAME COLUMN es_por_tapa        TO es_por_medida;
ALTER TABLE productos            RENAME COLUMN tapas_por_envase   TO medidas_por_envase;
ALTER TABLE productos            RENAME COLUMN tapa_ml            TO medida_ml;
ALTER TABLE productos            RENAME COLUMN stock_granel_tapas TO stock_granel_medidas;
ALTER TABLE producto_movimientos RENAME COLUMN cantidad_tapas     TO cantidad_medidas;
ALTER TABLE nota_productos       RENAME COLUMN cantidad_tapas     TO cantidad_medidas;

-- Unidad con que se cobró cada producto de una nota
ALTER TABLE nota_productos DROP CONSTRAINT IF EXISTS nota_productos_unidad_chk;
UPDATE nota_productos SET unidad = 'medida' WHERE unidad = 'tapa';
ALTER TABLE nota_productos ALTER COLUMN unidad SET DEFAULT 'medida';
ALTER TABLE nota_productos
  ADD CONSTRAINT nota_productos_unidad_chk CHECK (unidad IN ('botella', 'medida', 'pieza'));

-- Etiqueta de unidad del producto
UPDATE productos SET unidad = 'Medidas' WHERE unidad = 'Tapas';

-- Texto amigable del historial de movimientos ("3 tapas" → "3 medidas")
UPDATE producto_movimientos
   SET descripcion = regexp_replace(regexp_replace(descripcion, '\mtapa', 'medida', 'g'), '\mTapa', 'Medida', 'g')
 WHERE descripcion ~* '\mtapa';
