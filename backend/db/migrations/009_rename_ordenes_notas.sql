-- ============================================================
-- Migración 009: Renombrar ordenes → notas
-- ============================================================

-- Renombrar tabla principal
ALTER TABLE ordenes RENAME TO notas;

-- Renombrar tabla pivote
ALTER TABLE orden_articulos RENAME TO nota_productos;

-- Renombrar columna en nota_productos
ALTER TABLE nota_productos RENAME COLUMN orden_id TO nota_id;

-- Renombrar columna en movimientos_insumos
ALTER TABLE movimientos_insumos RENAME COLUMN orden_id TO nota_id;

-- Renombrar secuencia si existe
ALTER SEQUENCE IF EXISTS ordenes_id_seq RENAME TO notas_id_seq;

-- Renombrar índices
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT indexname FROM pg_indexes
           WHERE tablename = 'notas'
           AND indexname LIKE '%orden%'
  LOOP
    EXECUTE 'ALTER INDEX ' || r.indexname ||
            ' RENAME TO ' ||
            REPLACE(r.indexname, 'orden', 'nota');
  END LOOP;
END $$;

-- Renombrar índice de movimientos_insumos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_movimientos_orden') THEN
    ALTER INDEX idx_movimientos_orden RENAME TO idx_movimientos_nota;
  END IF;
END $$;

-- Renombrar trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ordenes_updated_at') THEN
    ALTER TRIGGER trg_ordenes_updated_at ON notas RENAME TO trg_notas_updated_at;
  END IF;
END $$;
