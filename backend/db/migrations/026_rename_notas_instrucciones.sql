-- ============================================================
-- Migración 026: notas — eliminar columna descripcion y renombrar notas → instrucciones
-- ============================================================

ALTER TABLE notas DROP COLUMN IF EXISTS descripcion;

ALTER TABLE notas RENAME COLUMN notas TO instrucciones;
