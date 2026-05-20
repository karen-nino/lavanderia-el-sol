-- Migración 011: telefono obligatorio y único en usuarios

ALTER TABLE usuarios ALTER COLUMN telefono SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_telefono_key ON usuarios (telefono);
