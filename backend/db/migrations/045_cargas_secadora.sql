-- ============================================================
-- Migración 045: cargas y tarifa independientes para la secadora
-- ============================================================
-- Autoservicio ahora cobra la lavadora y la secadora con cantidades
-- de cargas independientes:
--   total = cantidad_cargas × precio_base
--         + cantidad_cargas_secadora × precio_base_secadora
--         + productos + ajuste
--
-- `cantidad_cargas` / `precio_base` conservan su significado (lavadora).
-- Se agregan las dos columnas equivalentes para la secadora.

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS cantidad_cargas_secadora INTEGER,
  ADD COLUMN IF NOT EXISTS precio_base_secadora     NUMERIC(10,2);
