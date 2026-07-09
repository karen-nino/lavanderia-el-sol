-- Migración 042: catálogos editables de tela y tamaño de edredón + persistir en notas
-- Fecha: 2026-07-08
--
-- "Tipo de tela" (para Ropa) y "Tamaño del edredón" pasan a ser catálogos que
-- el admin puede gestionar en Ajustes. Son solo etiquetas internas: no afectan
-- el precio del servicio. Las notas guardan el nombre elegido como texto, de
-- modo que las notas viejas conservan su etiqueta aunque el catálogo cambie.

BEGIN;

CREATE TABLE IF NOT EXISTS tipos_tela (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tamanos_edredon (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tipos_tela (nombre) VALUES
  ('Mezclilla'),
  ('Algodón')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO tamanos_edredon (nombre) VALUES
  ('Individual'),
  ('Queen'),
  ('King')
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS tipo_tela      VARCHAR(60),
  ADD COLUMN IF NOT EXISTS tamano_edredon VARCHAR(60);

COMMIT;
