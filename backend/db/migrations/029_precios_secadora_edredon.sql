-- Migración 029: precios para secadora y edredón jumbo
-- Fecha: 2026-06-16
--
-- Agrega tres ajustes nuevos:
--   - precio_carga_secadora  (default 45.00)
--   - tiempo_carga_secadora  (default 30 min)
--   - precio_edredon_jumbo   (default 80.00)
--
-- El servicio Edredón se cobra como tarifa fija por carga en máquina jumbo;
-- el tiempo de ciclo lo hereda de tiempo_carga_jumbo.

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_carga_secadora NUMERIC(10,2) NOT NULL DEFAULT 45.00,
  ADD COLUMN IF NOT EXISTS tiempo_carga_secadora INTEGER       NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS precio_edredon_jumbo  NUMERIC(10,2) NOT NULL DEFAULT 80.00;
