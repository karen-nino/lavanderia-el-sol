-- ============================================================
-- Migración 006: Agrega cantidad_cargas a ordenes
-- Fecha: 2026-03-18
-- ============================================================
BEGIN;

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS cantidad_cargas INTEGER NOT NULL DEFAULT 1;

COMMIT;
