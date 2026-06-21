-- Migración 031: capacidad de la máquina
-- Fecha: 2026-06-20
--
-- Agrega la capacidad de carga de la máquina (20kg / 35kg). Se deja
-- nullable para no romper las máquinas ya registradas; las nuevas se
-- crean siempre con una capacidad desde el formulario.

BEGIN;

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS capacidad VARCHAR(10);

ALTER TABLE maquinas
  ADD CONSTRAINT maquinas_capacidad_check
  CHECK (capacidad IS NULL OR capacidad IN ('20kg', '35kg'));

COMMIT;
