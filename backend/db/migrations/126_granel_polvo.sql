-- Migración 126: el granel puede ser líquido o EN POLVO
-- Fecha: 2026-09-30
--
-- Hasta hoy todo el inventario de limpieza se modeló como líquido: el granel se
-- sirve por tapas/medidas de un bidón y los de marca se venden por envase
-- completo. Pero el jabón EN POLVO no se sirve por medidas: se vende por unidad,
-- igual que un producto de marca.
--
--   forma → 'liquido' (como hasta ahora) | 'polvo'
--
-- El polvo se guarda como un granel (tipo_liquido='granel', su nombre sale del
-- catálogo de graneles) pero SIN bidón ni tapa: botella_ml = tapa_ml = 1, que es
-- el mismo truco con el que los de marca cuentan su existencia en unidades.
--
-- Para no repetir "marca o polvo" en cada consulta, la regla que de verdad
-- importa —si el producto se vende por UNIDAD entera o se sirve por medidas—
-- queda en una columna calculada. Es lo que decide el precio de la línea, la
-- unidad del movimiento y, en Por Encargo, si el producto se cobra aparte
-- (por unidad) o cuenta contra el tope del servicio (servido por medidas).

BEGIN;

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS forma TEXT NOT NULL DEFAULT 'liquido';

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_forma_chk;
ALTER TABLE productos ADD CONSTRAINT productos_forma_chk
  CHECK (forma IN ('liquido', 'polvo'));

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS se_vende_por_unidad BOOLEAN
  GENERATED ALWAYS AS (
    COALESCE(tipo_liquido, '') = 'marca'
    OR (clase = 'liquido' AND forma = 'polvo')
  ) STORED;

COMMIT;
