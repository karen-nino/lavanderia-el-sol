-- Migración 091: R.F.C. y CURP del negocio
-- ============================================================
-- Datos fiscales del negocio (Ajustes → Negocio global), junto al nombre y el
-- logo. Son opcionales: NULL mientras no se capturen.

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS rfc  VARCHAR(13);
ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS curp VARCHAR(18);
