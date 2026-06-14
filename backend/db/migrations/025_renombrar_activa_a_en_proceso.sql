-- Migración 025: renombrar el estado interno ACTIVA a EN_PROCESO
-- Fecha: 2026-06-13
--
-- Después de la consolidación previa solo queda un estado inicial. Se renombra
-- el valor en el enum estado_orden para que coincida con la etiqueta visible
-- (En Proceso). Recreamos el enum porque ALTER TYPE ... RENAME VALUE no estaba
-- disponible en todas las versiones de Postgres antes de la 10 y, además,
-- queremos preservar el orden lógico.

CREATE TYPE estado_orden_new AS ENUM (
  'EN_PROCESO', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'
);

ALTER TABLE notas ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE notas
  ALTER COLUMN estado TYPE estado_orden_new
  USING (
    CASE estado::text
      WHEN 'ACTIVA' THEN 'EN_PROCESO'
      ELSE estado::text
    END
  )::estado_orden_new;
ALTER TABLE notas ALTER COLUMN estado SET DEFAULT 'EN_PROCESO'::estado_orden_new;

DROP TYPE estado_orden;
ALTER TYPE estado_orden_new RENAME TO estado_orden;
