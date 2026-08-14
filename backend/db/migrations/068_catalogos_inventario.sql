-- Migración 068: catálogos editables de Categoría y Envase de productos
-- ============================================================
-- Antes estaban fijos en el código del frontend. Pasan a ser catálogos que el
-- admin gestiona en Ajustes → Inventario (mismo mecanismo que las etiquetas de
-- encargo: nombre + activo, se desactivan en vez de borrarse). Los productos
-- guardan la categoría/envase como texto, así que desactivar una opción no
-- afecta a los productos existentes.

CREATE TABLE IF NOT EXISTS categorias_producto (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS envases_producto (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categorias_producto (nombre) VALUES
  ('Detergente'),
  ('Suavizante'),
  ('Blanqueador'),
  ('Otro')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO envases_producto (nombre) VALUES
  ('Cubeta'),
  ('Garrafa'),
  ('Botella')
ON CONFLICT (nombre) DO NOTHING;
