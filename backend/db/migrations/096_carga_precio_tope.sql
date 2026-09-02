-- Migración 096: congelar el tope (precio) de cada carga Por Encargo
-- Fecha: 2026-09-02
--
-- En Por Encargo el tope del tamaño ES el precio que se cobra por la carga.
-- Ese tope se leía de `ajustes` cada vez que se recalculaba el total, así que
-- cambiar los precios en Ajustes re-tarifaba notas viejas: una nota cobrada en
-- $150 pasaba a $200 al subir el tope, seguía marcada como PAGADA y el corte de
-- caja quedaba descuadrado. Bastaba con terminar el lavado o agregar un
-- producto para dispararlo.
--
-- Ahora el tope se congela en la carga al crearla, igual que ya se congelan
-- `precio_lavadora`, `precio_secadora` y `empaquetado`. Los precios nuevos solo
-- aplican a cargas nuevas.
--
-- NULL = carga sin tope (Autoservicio, y las cargas extra que se agregan desde
-- Salidas, que no tienen tamaño): se cobran por la suma de lo que llevan.

ALTER TABLE nota_cargas ADD COLUMN IF NOT EXISTS precio_tope NUMERIC(10,2);

-- Backfill: las cargas que ya existen conservan el tope vigente de su tamaño,
-- que es justo el precio con el que se calcularon hasta hoy.
UPDATE nota_cargas nc
   SET precio_tope = CASE
         WHEN UPPER(COALESCE(nc.tipo_prenda, '')) = 'EDREDON' THEN a.tope_carga_edredon
         WHEN nc.tamano = 'chico'  THEN a.tope_carga_chico
         WHEN nc.tamano = 'grande' THEN a.tope_carga_grande
         WHEN nc.tamano = 'jumbo'  THEN a.tope_carga_jumbo
       END
  FROM notas n, ajustes a
 WHERE n.id = nc.nota_id
   AND a.id = 1
   AND n.tipo_servicio = 'POR_ENCARGO'
   AND nc.precio_tope IS NULL;
