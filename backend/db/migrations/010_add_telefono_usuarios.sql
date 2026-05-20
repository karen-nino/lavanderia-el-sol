-- Migración 010: agregar columna telefono a usuarios

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
