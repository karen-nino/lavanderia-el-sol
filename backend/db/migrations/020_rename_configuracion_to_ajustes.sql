-- Migración 020: renombrar tabla configuracion a ajustes
-- Fecha: 2026-06-12

ALTER TABLE IF EXISTS configuracion RENAME TO ajustes;
