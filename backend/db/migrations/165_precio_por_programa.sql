-- Migración 165: precio por programa del modelo que pregunta (Sec49)
-- Fecha: 2026-10-22
--
-- A pedido de la usuaria, en Autoservicio la secadora que pregunta su programa
-- se cobra según el programa que elige el empleado al darle Iniciar (1 min $20,
-- 2 min $40, 3 min $50). Hasta entonces la secadora queda "por definir" y la
-- nota no se puede liquidar. En Por Encargo el secado va en el servicio.
--   · modelos_maquina.precio_programa_2/3/4: el precio de cada programa
--     (minutos_2/3/4); NULL = ese programa se cobra como antes, por tamaño.
--   · nota_cargas.secadora_por_definir: la secadora de la carga espera el
--     programa para tener precio (precio_secadora = 0 mientras tanto).

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS precio_programa_2 NUMERIC(10, 2);
ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS precio_programa_3 NUMERIC(10, 2);
ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS precio_programa_4 NUMERIC(10, 2);

ALTER TABLE nota_cargas ADD COLUMN IF NOT EXISTS secadora_por_definir BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
