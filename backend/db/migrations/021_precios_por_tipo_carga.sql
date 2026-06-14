-- Migración 021: precios por tipo de carga (mediana / jumbo)
-- Fecha: 2026-06-13
--
-- Renombra precio_autoservicio a precio_carga_mediana y agrega precio_carga_jumbo.
-- El precio jumbo arranca con el mismo valor existente para no romper notas previas;
-- los administradores pueden ajustarlo después desde la pantalla de Ajustes.

ALTER TABLE ajustes
  RENAME COLUMN precio_autoservicio TO precio_carga_mediana;

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS precio_carga_jumbo NUMERIC(10,2) NOT NULL DEFAULT 70.00;

UPDATE ajustes
  SET precio_carga_jumbo = precio_carga_mediana
  WHERE id = 1;
