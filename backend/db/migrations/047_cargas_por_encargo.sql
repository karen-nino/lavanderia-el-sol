-- ============================================================
-- Migración 047: atributos de encargo por carga
-- ============================================================
-- Por Encargo pasa de tener prenda/tamaño/tela/ajuste a nivel nota a
-- tenerlos por carga (igual que las máquinas). Cada carga es autónoma:
-- su prenda, tela o tamaño de edredón, tamaño de carga, ajuste y sus
-- propios productos.
--
-- Compatibilidad: las notas de encargo viejas no tienen filas en
-- nota_cargas y siguen leyéndose desde las columnas de `notas`. Solo las
-- notas nuevas (autoservicio y encargo) usan nota_cargas.

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS tamano         TEXT,
  ADD COLUMN IF NOT EXISTS tipo_prenda    TEXT,
  ADD COLUMN IF NOT EXISTS tipo_tela      TEXT,
  ADD COLUMN IF NOT EXISTS tamano_edredon TEXT,
  ADD COLUMN IF NOT EXISTS ajuste         NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Productos por carga. carga_id NULL = producto a nivel nota (autoservicio).
ALTER TABLE nota_productos
  ADD COLUMN IF NOT EXISTS carga_id INTEGER REFERENCES nota_cargas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_nota_productos_carga ON nota_productos(carga_id);
