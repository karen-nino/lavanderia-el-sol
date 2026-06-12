-- Migración 018: agregar columna apellido a clientes
-- Fecha: 2026-06-11

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);
