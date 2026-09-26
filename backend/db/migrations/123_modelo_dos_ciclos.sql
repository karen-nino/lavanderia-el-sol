-- Migración 123: los DOS ciclos por carga se declaran en el MODELO, al revés
-- Fecha: 2026-09-25
--
-- La 122 puso en la marca "una carga corre un solo ciclo". Al verlo, el negocio
-- pidió dos cambios:
--
--   · que viva en el **modelo** y no en la marca — es el aparato el que decide
--     si su programa alcanza para una carga, no el fabricante entero;
--   · que la casilla diga lo **contrario**: "una carga corre 2 ciclos". Lo
--     normal es un ciclo; la segunda vuelta es la excepción, y una excepción se
--     marca donde ocurre en vez de darse por hecho en todas.
--
-- Con eso, el valor por defecto se invierte: **una carga corre un solo ciclo**
-- salvo que el modelo de su máquina diga otra cosa. Decisión tomada sabiendo lo
-- que implica hoy: las ocho máquinas reales no tienen modelo capturado, así que
-- ninguna ofrece segunda vuelta hasta que se les elija uno y se marque la
-- casilla — incluidas las LG, que hasta ahora la tenían por venir con tiempo
-- configurado (mig. 108).

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS dos_ciclos BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN modelos_maquina.dos_ciclos IS
  'Una carga corre DOS ciclos en este modelo (mig. 108); sin esto, uno solo.';

-- La bandera de la marca se va: la sustituye la del modelo.
ALTER TABLE marcas_maquina DROP COLUMN IF EXISTS ciclo_unico;

COMMIT;
