-- Migración 160: horario de la sucursal POR DÍA, como en Google Maps
-- Fecha: 2026-10-11
--
-- La 159 lo guardaba como texto libre; el mismo día la usuaria lo pidió por
-- día (abierto/cerrado, abre y cierra). Se guarda como JSONB con los 7 días,
-- de lunes (0) a domingo (6):
--   [{ "dia": 0, "abierto": true, "abre": "10:00", "cierra": "20:30" }, ...]
-- NULL = sin horario capturado. La columna de texto de la 159 se quita: se
-- creó y se reemplazó el mismo día, sin datos reales.

BEGIN;

ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS horario_semana JSONB;
ALTER TABLE sucursales DROP COLUMN IF EXISTS horario;

COMMIT;
