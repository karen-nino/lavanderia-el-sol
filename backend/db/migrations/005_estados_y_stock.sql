-- ============================================================
-- Migración 005: Estados de orden (nuevo ENUM) + stock artículos
-- Fecha: 2026-03-18
-- ============================================================
-- CAMBIOS:
--   1. Crea tabla articulos (si no existe)
--   2. ENUM estado_orden → ACTIVA | EN_PROCESO | LISTA | PAGADA | ENTREGADA | CANCELADA
--      (mapea RECIBIDO→ACTIVA, LISTO→LISTA, ENTREGADO→ENTREGADA)
--   3. Agrega columna stock_reservado a articulos
--   4. Crea tabla orden_articulos
-- ============================================================

BEGIN;

-- ── 1. Tabla articulos ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS articulos (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  unidad          VARCHAR(50)  NOT NULL DEFAULT 'pieza',
  precio_unitario NUMERIC(10,2),
  stock_actual    INTEGER      NOT NULL DEFAULT 0,
  stock_minimo    INTEGER      NOT NULL DEFAULT 0,
  stock_reservado INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Por si la tabla ya existía sin stock_reservado
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS stock_reservado INTEGER NOT NULL DEFAULT 0;

-- ── 2. Actualizar ENUM estado_orden ──────────────────────────
-- PostgreSQL no permite eliminar valores de un ENUM existente.
-- Solución: crear tipo nuevo, migrar columna, renombrar.

CREATE TYPE estado_orden_v5 AS ENUM (
  'ACTIVA', 'EN_PROCESO', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'
);

-- Quitar DEFAULT antes de cambiar el tipo
ALTER TABLE ordenes ALTER COLUMN estado DROP DEFAULT;

ALTER TABLE ordenes
  ALTER COLUMN estado TYPE estado_orden_v5
  USING CASE estado::text
    WHEN 'RECIBIDO'   THEN 'ACTIVA'::estado_orden_v5
    WHEN 'EN_PROCESO' THEN 'EN_PROCESO'::estado_orden_v5
    WHEN 'LISTO'      THEN 'LISTA'::estado_orden_v5
    WHEN 'ENTREGADO'  THEN 'ENTREGADA'::estado_orden_v5
    ELSE 'ACTIVA'::estado_orden_v5
  END;

DROP TYPE estado_orden;
ALTER TYPE estado_orden_v5 RENAME TO estado_orden;

ALTER TABLE ordenes ALTER COLUMN estado SET DEFAULT 'ACTIVA'::estado_orden;

-- Recrear índice (fue creado sobre el tipo viejo)
DROP INDEX IF EXISTS idx_ordenes_estado;
CREATE INDEX idx_ordenes_estado ON ordenes(estado);

-- ── 3. Tabla orden_articulos ──────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_articulos (
  id              SERIAL PRIMARY KEY,
  orden_id        INTEGER      NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  articulo_id     INTEGER      NOT NULL REFERENCES articulos(id),
  cantidad        INTEGER      NOT NULL,
  precio_unitario NUMERIC(10,2) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orden_articulos_orden    ON orden_articulos(orden_id);
CREATE INDEX IF NOT EXISTS idx_orden_articulos_articulo ON orden_articulos(articulo_id);

COMMIT;
