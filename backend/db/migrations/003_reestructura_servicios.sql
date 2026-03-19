-- ============================================================
-- Migración 003: Reestructura del modelo de servicios
-- Fecha: 2026-03-12
-- ============================================================
-- CAMBIOS:
--   1. ENUM modalidad_orden  → AUTOSERVICIO | EDREDON | POR_ENCARGO
--   2. ENUM estado_pago_orden → DEBE | PAGADO  (elimina CONTADO y N/A)
--   3. Columna tamano VARCHAR(10) nullable
--   4. Columna precio_base NUMERIC(10,2) nullable
--   5. Columna ajuste NUMERIC(10,2) NOT NULL DEFAULT 0
-- ============================================================

BEGIN;

-- ── 1. Actualizar ENUM modalidad_orden ────────────────────────
-- PostgreSQL no permite DROP de valores en ENUMs existentes,
-- se crea un tipo nuevo, se migra la columna y se intercambia.
-- Es necesario eliminar el DEFAULT antes de cambiar el tipo.

CREATE TYPE modalidad_orden_v3 AS ENUM ('AUTOSERVICIO', 'EDREDON', 'POR_ENCARGO');

ALTER TABLE ordenes ALTER COLUMN modalidad DROP DEFAULT;

ALTER TABLE ordenes
  ALTER COLUMN modalidad TYPE modalidad_orden_v3
  USING modalidad::text::modalidad_orden_v3;

DROP TYPE modalidad_orden;
ALTER TYPE modalidad_orden_v3 RENAME TO modalidad_orden;


-- ── 2. Actualizar ENUM estado_pago_orden ─────────────────────
-- Conversión de datos existentes:
--   CONTADO → PAGADO
--   DEBE    → DEBE
--   N/A     → PAGADO  (autoservicio es pago inmediato en efectivo)

CREATE TYPE estado_pago_orden_v3 AS ENUM ('DEBE', 'PAGADO');

ALTER TABLE ordenes ALTER COLUMN estado_pago DROP DEFAULT;

ALTER TABLE ordenes
  ALTER COLUMN estado_pago TYPE estado_pago_orden_v3
  USING CASE estado_pago::text
    WHEN 'CONTADO' THEN 'PAGADO'
    WHEN 'DEBE'    THEN 'DEBE'
    ELSE                'PAGADO'   -- N/A y cualquier valor inesperado
  END::estado_pago_orden_v3;

-- Actualizar el DEFAULT de la columna
ALTER TABLE ordenes
  ALTER COLUMN estado_pago SET DEFAULT 'PAGADO';

DROP TYPE estado_pago_orden;
ALTER TYPE estado_pago_orden_v3 RENAME TO estado_pago_orden;


-- ── 3. Columna tamano ─────────────────────────────────────────
-- Valores esperados: 'chico' | 'grande' | NULL
-- Solo aplica a POR_ENCARGO; AUTOSERVICIO y EDREDON dejan NULL.

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS tamano VARCHAR(10) NULL;


-- ── 4. Columna precio_base ────────────────────────────────────
-- NULL hasta que el sistema configure los precios base.

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS precio_base NUMERIC(10,2) NULL;


-- ── 5. Columna ajuste ─────────────────────────────────────────
-- Ajuste positivo (cargo extra) o negativo (descuento).
-- precio_total = precio_base + ajuste para EDREDON y POR_ENCARGO.

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS ajuste NUMERIC(10,2) NOT NULL DEFAULT 0;


-- ── 6. Índices de apoyo ───────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ordenes_tamano ON ordenes(tamano);

COMMIT;
