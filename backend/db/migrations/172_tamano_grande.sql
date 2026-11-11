-- Migración 172: tamaño Grande de lavadora y secadora
-- Fecha: 2026-11-10
--
-- A pedido de la usuaria, las máquinas pasan de dos tamaños (Mediana y Jumbo)
-- a tres: Mediana, Grande y Jumbo. La lavadora grande es un tipo nuevo
-- (lavadora_grande) con precio y tiempo propios en Ajustes; la secadora grande
-- es un tamaño (como la jumbo) con tiempo propio; el secado sigue siendo un
-- precio único. Los modelos de máquina y el tipo previsto de la carga también
-- admiten 'grande'. Los precios y tiempos nuevos arrancan iguales a los de la
-- mediana, para que nada cambie hasta que la usuaria los capture.

BEGIN;

-- Se puede agregar dentro de la transacción mientras aquí no se use el valor.
ALTER TYPE tipo_maquina ADD VALUE IF NOT EXISTS 'lavadora_grande' AFTER 'lavadora_mediana';

ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_tamano_check;
ALTER TABLE maquinas ADD CONSTRAINT maquinas_tamano_check
  CHECK (tamano IS NULL OR tamano IN ('mediana', 'grande', 'jumbo'));

ALTER TABLE modelos_maquina DROP CONSTRAINT IF EXISTS modelos_maquina_tamano_chk;
ALTER TABLE modelos_maquina ADD CONSTRAINT modelos_maquina_tamano_chk
  CHECK (tamano IN ('mediana', 'grande', 'jumbo'));

ALTER TABLE nota_cargas DROP CONSTRAINT IF EXISTS nota_cargas_lavadora_tipo_check;
ALTER TABLE nota_cargas ADD CONSTRAINT nota_cargas_lavadora_tipo_check
  CHECK (lavadora_tipo IS NULL OR lavadora_tipo IN ('mediana', 'grande', 'jumbo', 'edredon'));
ALTER TABLE nota_cargas DROP CONSTRAINT IF EXISTS nota_cargas_secadora_tipo_check;
ALTER TABLE nota_cargas ADD CONSTRAINT nota_cargas_secadora_tipo_check
  CHECK (secadora_tipo IS NULL OR secadora_tipo IN ('mediana', 'grande', 'jumbo', 'edredon'));

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_carga_grande    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tiempo_carga_grande    INTEGER,
  ADD COLUMN IF NOT EXISTS tiempo_secadora_grande INTEGER;

UPDATE ajustes
   SET precio_carga_grande    = COALESCE(precio_carga_grande, precio_carga_mediana),
       tiempo_carga_grande    = COALESCE(tiempo_carga_grande, tiempo_carga_mediana),
       tiempo_secadora_grande = COALESCE(tiempo_secadora_grande, tiempo_carga_secadora);

ALTER TABLE ajustes
  ALTER COLUMN precio_carga_grande    SET DEFAULT 70.00,
  ALTER COLUMN precio_carga_grande    SET NOT NULL,
  ALTER COLUMN tiempo_carga_grande    SET DEFAULT 30,
  ALTER COLUMN tiempo_carga_grande    SET NOT NULL,
  ALTER COLUMN tiempo_secadora_grande SET DEFAULT 30;

COMMIT;
