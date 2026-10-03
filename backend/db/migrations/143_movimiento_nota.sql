-- Migración 143: la salida manual lleva una NOTA libre en lugar de un motivo
-- Fecha: 2026-10-03
--
-- La 142 guardaba el motivo de una salida manual elegido de una lista corta
-- (Merma, Dañado, Uso interno, Regalo, Otro), en 100 caracteres. El negocio
-- prefirió un campo de texto grande para escribir lo que haga falta, y que no
-- sea obligatorio: se renombra a `nota` y pasa a TEXT. Lo ya capturado como
-- motivo se conserva tal cual.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'producto_movimientos' AND column_name = 'motivo') THEN
    ALTER TABLE producto_movimientos RENAME COLUMN motivo TO nota;
  END IF;
END $$;

ALTER TABLE producto_movimientos
  ADD COLUMN IF NOT EXISTS nota TEXT;

ALTER TABLE producto_movimientos
  ALTER COLUMN nota TYPE TEXT;
