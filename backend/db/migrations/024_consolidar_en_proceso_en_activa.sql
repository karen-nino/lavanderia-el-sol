-- Migración 024: consolidar estado EN_PROCESO en ACTIVA
-- Fecha: 2026-06-13
--
-- ACTIVA y EN_PROCESO representaban lo mismo (nota en curso). Se conserva
-- ACTIVA y se elimina EN_PROCESO del enum estado_orden. Postgres no permite
-- borrar valores de un enum directamente, así que se recrea el tipo.

-- 1. Mover cualquier nota residual a ACTIVA.
UPDATE notas SET estado = 'ACTIVA' WHERE estado = 'EN_PROCESO';

-- 2. Crear el nuevo enum sin EN_PROCESO.
CREATE TYPE estado_orden_new AS ENUM (
  'ACTIVA', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'
);

-- 3. Reapuntar la columna al nuevo tipo y restaurar default.
ALTER TABLE notas ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE notas
  ALTER COLUMN estado TYPE estado_orden_new
  USING estado::text::estado_orden_new;
ALTER TABLE notas ALTER COLUMN estado SET DEFAULT 'ACTIVA'::estado_orden_new;

-- 4. Renombrar para preservar el nombre original.
DROP TYPE estado_orden;
ALTER TYPE estado_orden_new RENAME TO estado_orden;
