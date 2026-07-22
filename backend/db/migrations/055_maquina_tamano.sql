-- Tamaño de máquina (mediana / jumbo) para TODAS las máquinas, incluidas las
-- secadoras. En las lavadoras el tamaño ya vive en el enum tipo
-- (lavadora_mediana/jumbo); esta columna lo replica para poder mostrarlo y
-- editarlo de forma uniforme, y le da tamaño a las secadoras (cuyo tipo plano
-- 'secadora' no lo distinguía). Se usa para información/gestión; el cobro del
-- secado sigue derivándose de la categoría de la carga (mirror de la lavadora).
ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS tamano VARCHAR(10)
  CHECK (tamano IS NULL OR tamano IN ('mediana', 'jumbo'));

-- Backfill: lavadoras según su tipo; secadoras existentes a 'mediana' por defecto.
UPDATE maquinas SET tamano = 'jumbo'   WHERE tamano IS NULL AND tipo = 'lavadora_jumbo';
UPDATE maquinas SET tamano = 'mediana' WHERE tamano IS NULL AND tipo IN ('lavadora_mediana', 'secadora');
