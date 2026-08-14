-- Migración 065: asegurar la columna stock_minimo en productos
-- ============================================================
-- La migración 005 definía stock_minimo dentro del CREATE TABLE ... IF NOT
-- EXISTS, así que en las bases donde la tabla ya existía la columna nunca se
-- creó. El feature "por tapa/medida" (064) la usa como umbral de alerta en
-- tapas, y su ausencia rompía getProductos. Idempotente.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0;
