-- Migración 015: eliminar columnas email y telefono de usuarios
-- La app ya no usa estos campos (login es por id + password con autocomplete).

ALTER TABLE usuarios DROP COLUMN IF EXISTS email;
ALTER TABLE usuarios DROP COLUMN IF EXISTS telefono;
