-- ============================================================
-- Migración 051: precio y tiempo de secado por tipo de carga
-- ============================================================
-- La secadora es un solo tipo de máquina, pero el negocio quiere cobrar
-- (y cronometrar) el secado según la categoría de la carga, igual que la
-- lavadora: Mediana / Jumbo / Edredón. La categoría se deduce de la carga
-- (prenda edredón → Edredón; lavadora jumbo → Jumbo; resto → Mediana).
--
-- Para no romper lectores legados ni duplicar datos, la columna existente
-- precio_carga_secadora / tiempo_carga_secadora pasa a representar la
-- categoría MEDIANA. Solo se agregan Jumbo y Edredón, sembrados con el
-- valor plano actual para que nada cambie de precio hasta que el admin
-- los configure.
ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_secadora_jumbo   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS precio_secadora_edredon NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tiempo_secadora_jumbo   INTEGER,
  ADD COLUMN IF NOT EXISTS tiempo_secadora_edredon INTEGER;

UPDATE ajustes SET
  precio_secadora_jumbo   = COALESCE(precio_secadora_jumbo,   precio_carga_secadora),
  precio_secadora_edredon = COALESCE(precio_secadora_edredon, precio_carga_secadora),
  tiempo_secadora_jumbo   = COALESCE(tiempo_secadora_jumbo,   tiempo_carga_secadora),
  tiempo_secadora_edredon = COALESCE(tiempo_secadora_edredon, tiempo_carga_secadora)
WHERE id = 1;

ALTER TABLE ajustes
  ALTER COLUMN precio_secadora_jumbo   SET DEFAULT 45.00,
  ALTER COLUMN precio_secadora_edredon SET DEFAULT 45.00,
  ALTER COLUMN tiempo_secadora_jumbo   SET DEFAULT 30,
  ALTER COLUMN tiempo_secadora_edredon SET DEFAULT 30;

-- Minutos del ciclo con que arrancó una máquina, sellados al ponerla en uso.
-- Necesario para el temporizador de las secadoras: como su duración depende
-- del tipo de carga (no del tipo de máquina), no se puede deducir por tipo.
-- NULL = usar el fallback por tipo (máquinas en uso antes de esta migración).
ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS ciclo_minutos INTEGER;
