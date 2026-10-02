-- Migración 132: cuánto se precarga lo dice el SERVICIO, no el producto
-- ============================================================
-- En la 131 cada granel decía cuántas medidas se le ponían a un servicio. Se
-- prefirió al revés: el granel solo dice a qué servicios va ligado, y cada
-- servicio dice en Ajustes → Servicios Por Encargo cuántas medidas de granel y
-- cuántas bolsas trae puestas. Chico, Mediano y Grande lo guardan en `ajustes`;
-- cada tamaño de edredón, en su catálogo, junto a su precio.
--
-- Todo arranca en 0: ningún servicio trae nada puesto hasta que se configure.

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_medidas_precarga_chk;
ALTER TABLE productos DROP COLUMN IF EXISTS medidas_precarga;

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precarga_medidas_chico   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_medidas_mediano INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_medidas_grande  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_bolsas_chico    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_bolsas_mediano  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_bolsas_grande   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ajustes DROP CONSTRAINT IF EXISTS ajustes_precarga_chk;
ALTER TABLE ajustes ADD CONSTRAINT ajustes_precarga_chk CHECK (
  precarga_medidas_chico >= 0 AND precarga_medidas_mediano >= 0 AND precarga_medidas_grande >= 0
  AND precarga_bolsas_chico >= 0 AND precarga_bolsas_mediano >= 0 AND precarga_bolsas_grande >= 0
);

ALTER TABLE tamanos_edredon
  ADD COLUMN IF NOT EXISTS precarga_medidas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS precarga_bolsas  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tamanos_edredon DROP CONSTRAINT IF EXISTS tamanos_edredon_precarga_chk;
ALTER TABLE tamanos_edredon ADD CONSTRAINT tamanos_edredon_precarga_chk
  CHECK (precarga_medidas >= 0 AND precarga_bolsas >= 0);
