-- Migración 174: precio del secado por tamaño de secadora
-- Fecha: 2026-11-10
--
-- Hasta hoy el secado tenía un solo precio (precio_carga_secadora) para
-- cualquier secadora, aunque Ajustes enseñaba "Precio secado jumbo"
-- (precio_secadora_jumbo), que solo usaban algunos reportes. A pedido de la
-- usuaria, cada tamaño cobra su propio precio: Chica, Mediana
-- (precio_carga_secadora), Grande y Jumbo (precio_secadora_jumbo). Chica y
-- Grande arrancan iguales a la mediana.

BEGIN;

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_secadora_chica  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS precio_secadora_grande NUMERIC(10,2);

UPDATE ajustes
   SET precio_secadora_chica  = COALESCE(precio_secadora_chica, precio_carga_secadora),
       precio_secadora_grande = COALESCE(precio_secadora_grande, precio_carga_secadora);

ALTER TABLE ajustes
  ALTER COLUMN precio_secadora_chica  SET DEFAULT 45.00,
  ALTER COLUMN precio_secadora_chica  SET NOT NULL,
  ALTER COLUMN precio_secadora_grande SET DEFAULT 45.00,
  ALTER COLUMN precio_secadora_grande SET NOT NULL;

COMMIT;
