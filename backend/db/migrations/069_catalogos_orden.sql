-- Migración 069: orden manual (arrastrable) en los catálogos editables
-- ============================================================
-- Los catálogos (tipos de tela, tamaños de edredón, categorías y envases de
-- producto) pasan a tener un orden manual que el admin ajusta arrastrando en
-- Ajustes. Ese orden también define cómo se listan en los formularios. Se
-- inicializa con el id (orden de creación/semilla).

ALTER TABLE tipos_tela          ADD COLUMN IF NOT EXISTS orden INTEGER;
ALTER TABLE tamanos_edredon     ADD COLUMN IF NOT EXISTS orden INTEGER;
ALTER TABLE categorias_producto ADD COLUMN IF NOT EXISTS orden INTEGER;
ALTER TABLE envases_producto    ADD COLUMN IF NOT EXISTS orden INTEGER;

UPDATE tipos_tela          SET orden = id WHERE orden IS NULL;
UPDATE tamanos_edredon     SET orden = id WHERE orden IS NULL;
UPDATE categorias_producto SET orden = id WHERE orden IS NULL;
UPDATE envases_producto    SET orden = id WHERE orden IS NULL;
