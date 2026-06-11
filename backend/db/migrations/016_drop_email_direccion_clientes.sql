-- Migración 016: eliminar columnas email y direccion de clientes
-- Fecha: 2026-06-11

ALTER TABLE clientes DROP COLUMN IF EXISTS email;
ALTER TABLE clientes DROP COLUMN IF EXISTS direccion;
