-- Migración 179: tipos de ficha por sucursal
-- Fecha: 2026-11-13
--
-- Cada máquina usa la ficha de su tipo (las de Zapopan no son iguales entre
-- sí). A pedido de la usuaria:
-- - Catálogo de tipos por sucursal (Ajustes → Fichas), cada uno con su conteo
--   de disponibles; el admin da de alta, renombra y quita tipos.
-- - Cada máquina de fichas elige su tipo: al iniciarla salen de las de su tipo
--   y al recogerlas vuelven a él.
-- - La máquina sin tipo sigue con el conteo general de la sucursal
--   (sucursales.fichas_disponibles), que en Ajustes y Fichas sale como "Sin tipo".
-- - El historial guarda de qué tipo fue cada movimiento (y su nombre, por si
--   después se quita).
-- Arranque: Zapopan con su clasificación y todos los tipos en 0; la usuaria
-- captura cuántas hay de cada uno.

BEGIN;

CREATE TABLE IF NOT EXISTS fichas_tipos (
  id          SERIAL PRIMARY KEY,
  sucursal    TEXT        NOT NULL REFERENCES sucursales(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  nombre      TEXT        NOT NULL,
  disponibles INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS fichas_tipos_nombre_idx ON fichas_tipos (sucursal, LOWER(nombre));

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS ficha_tipo_id INTEGER REFERENCES fichas_tipos(id) ON DELETE SET NULL;

ALTER TABLE fichas_movimientos
  ADD COLUMN IF NOT EXISTS ficha_tipo_id     INTEGER REFERENCES fichas_tipos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ficha_tipo_nombre TEXT;

-- Zapopan: los cinco tipos y sus máquinas ("S1" o "S1 MAY", sin importar mayúsculas).
INSERT INTO fichas_tipos (sucursal, nombre)
SELECT 'zapopan', t.nombre
  FROM (VALUES ('Lavadora Cuadrada'), ('Lavadora Redonda'), ('Secadora Blanca'),
               ('Secadora doble'), ('Secadora Amarilla')) AS t(nombre)
 WHERE EXISTS (SELECT 1 FROM sucursales WHERE slug = 'zapopan')
ON CONFLICT DO NOTHING;

UPDATE maquinas m
   SET ficha_tipo_id = ft.id
  FROM (VALUES ('L2', 'Lavadora Cuadrada'),
               ('L1', 'Lavadora Redonda'), ('L3', 'Lavadora Redonda'),
               ('S1', 'Secadora Blanca'),
               ('S4', 'Secadora doble'),   ('S5', 'Secadora doble'),
               ('S2', 'Secadora Amarilla'), ('S3', 'Secadora Amarilla')) AS c(maquina, tipo)
  JOIN fichas_tipos ft ON ft.sucursal = 'zapopan' AND ft.nombre = c.tipo
 WHERE m.sucursal = 'zapopan'
   AND UPPER(TRIM(m.nombre)) IN (c.maquina || ' MAY', CASE WHEN c.maquina LIKE 'S%' THEN c.maquina END);

COMMIT;
