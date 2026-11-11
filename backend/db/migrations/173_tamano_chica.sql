-- Migración 173: tamaño Chica de lavadora y secadora
-- Fecha: 2026-11-10
--
-- Igual que la Grande (mig. 172): las máquinas quedan en cuatro tamaños,
-- Chica · Mediana · Grande · Jumbo. La lavadora chica es un tipo nuevo
-- (lavadora_chica) con precio y tiempo propios; la secadora chica es un tamaño
-- con tiempo propio (el secado sigue siendo un precio único). Arrancan iguales
-- a la mediana hasta que la usuaria los capture. No confundir con el servicio
-- "Chico" de Por Encargo.

BEGIN;

ALTER TYPE tipo_maquina ADD VALUE IF NOT EXISTS 'lavadora_chica' BEFORE 'lavadora_mediana';

ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_tamano_check;
ALTER TABLE maquinas ADD CONSTRAINT maquinas_tamano_check
  CHECK (tamano IS NULL OR tamano IN ('chica', 'mediana', 'grande', 'jumbo'));

ALTER TABLE modelos_maquina DROP CONSTRAINT IF EXISTS modelos_maquina_tamano_chk;
ALTER TABLE modelos_maquina ADD CONSTRAINT modelos_maquina_tamano_chk
  CHECK (tamano IN ('chica', 'mediana', 'grande', 'jumbo'));

ALTER TABLE nota_cargas DROP CONSTRAINT IF EXISTS nota_cargas_lavadora_tipo_check;
ALTER TABLE nota_cargas ADD CONSTRAINT nota_cargas_lavadora_tipo_check
  CHECK (lavadora_tipo IS NULL OR lavadora_tipo IN ('chica', 'mediana', 'grande', 'jumbo', 'edredon'));
ALTER TABLE nota_cargas DROP CONSTRAINT IF EXISTS nota_cargas_secadora_tipo_check;
ALTER TABLE nota_cargas ADD CONSTRAINT nota_cargas_secadora_tipo_check
  CHECK (secadora_tipo IS NULL OR secadora_tipo IN ('chica', 'mediana', 'grande', 'jumbo', 'edredon'));

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_carga_chica    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tiempo_carga_chica    INTEGER,
  ADD COLUMN IF NOT EXISTS tiempo_secadora_chica INTEGER;

UPDATE ajustes
   SET precio_carga_chica    = COALESCE(precio_carga_chica, precio_carga_mediana),
       tiempo_carga_chica    = COALESCE(tiempo_carga_chica, tiempo_carga_mediana),
       tiempo_secadora_chica = COALESCE(tiempo_secadora_chica, tiempo_carga_secadora);

ALTER TABLE ajustes
  ALTER COLUMN precio_carga_chica    SET DEFAULT 70.00,
  ALTER COLUMN precio_carga_chica    SET NOT NULL,
  ALTER COLUMN tiempo_carga_chica    SET DEFAULT 30,
  ALTER COLUMN tiempo_carga_chica    SET NOT NULL,
  ALTER COLUMN tiempo_secadora_chica SET DEFAULT 30;

COMMIT;
