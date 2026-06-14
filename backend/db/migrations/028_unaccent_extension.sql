-- ============================================================
-- Migración 028: habilitar extensión unaccent
-- ============================================================
-- Usada para búsquedas insensibles a acentos
-- (ej. "sofia" debe encontrar "Sofía").

CREATE EXTENSION IF NOT EXISTS unaccent;
