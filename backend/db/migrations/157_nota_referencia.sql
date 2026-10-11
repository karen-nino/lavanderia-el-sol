-- Migración 157: cliente / referencia libre en la nota de Autoservicio
-- Fecha: 2026-10-11
--
-- El autoservicio no lleva cliente del catálogo (queda a nombre de Mostrador).
-- Para saber de quién es la ropa en la lista de Notas, el mostrador puede
-- escribir un nombre o una seña ("Señora del suéter rojo"); la tarjeta lo
-- enseña en lugar de "Mostrador". Opcional.

BEGIN;

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS referencia VARCHAR(80);

COMMIT;
