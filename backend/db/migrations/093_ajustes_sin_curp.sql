-- Migración 093: fuera la CURP del negocio
-- ============================================================
-- Se agregó junto al R.F.C. en la 091, pero el negocio no la necesita: se
-- elimina el campo y sus datos. El R.F.C. se queda.

ALTER TABLE ajustes DROP COLUMN IF EXISTS curp;
