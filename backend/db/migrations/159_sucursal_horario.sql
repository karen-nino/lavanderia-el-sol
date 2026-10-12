-- Migración 159: horario de atención de cada sucursal
-- Fecha: 2026-10-11
--
-- Ajustes → Negocio y sucursales guarda el horario junto a la dirección y el
-- teléfono. Texto libre de varias líneas ("Lun a Sáb 8:00 a 20:00"), opcional.

BEGIN;

ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS horario TEXT;

COMMIT;
