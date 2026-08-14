-- Migración 066: archivar/ocultar productos
-- ============================================================
-- Un producto que ya se usó en notas no se puede borrar (rompería el
-- historial), pero sí se puede ARCHIVAR: desaparece del inventario y del
-- selector de Nueva Nota, conservando intactas las notas viejas. Reversible.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS archivado BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_productos_archivado ON productos(sucursal, archivado);
