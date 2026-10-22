-- Migración 166: cada servicio Por Encargo incluye solo sus bolsas
-- Fecha: 2026-10-22
--
-- Hasta hoy, en Por Encargo toda bolsa suelta de la nota iba dentro del precio
-- de los servicios, fueran las que fueran. A pedido de la usuaria, cada servicio
-- incluye las bolsas que dice Ajustes (Servicio Chico → Bolsas: 1); las de más
-- se cobran a su precio.
--   · nota_cargas.bolsa_producto_id / bolsas_incluidas: la bolsa ligada al
--     servicio y cuántas incluye, congeladas al crear la nota (cambiar Ajustes
--     no re-tarifa notas).
--   · notas.bolsas_todas_incluidas: las notas Por Encargo que ya existían
--     siguen con la regla vieja (ningún total viejo cambia).

BEGIN;

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS bolsa_producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bolsas_incluidas  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notas ADD COLUMN IF NOT EXISTS bolsas_todas_incluidas BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE notas SET bolsas_todas_incluidas = TRUE WHERE tipo_servicio = 'POR_ENCARGO';

COMMIT;
