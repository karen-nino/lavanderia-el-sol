-- Migración 092: el R.F.C. del negocio es texto libre
-- ============================================================
-- El campo se captura tal cual lo escribe el negocio (palabras, números,
-- espacios) y sin límite de largo, así que deja de ser VARCHAR(13).

ALTER TABLE ajustes ALTER COLUMN rfc TYPE TEXT;
