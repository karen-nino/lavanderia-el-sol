-- Migración 125: a qué servicios va ligada cada bolsa
-- Fecha: 2026-09-30
--
-- La bolsa se precarga sola en Por Encargo según el servicio de la carga. Hasta
-- hoy esa relación estaba CLAVADA EN EL CÓDIGO por el tamaño de la bolsa
-- (chico→chica, grande→grande, edredón→jumbo). Desde que el tamaño salió a un
-- catálogo editable (mig. 119) esos nombres son libres —"Negra", "Spe"— y el
-- mapa dejó de casar: una bolsa nueva jamás se precargaba.
--
-- Ahora la bolsa dice explícitamente a qué servicios pertenece:
--   servicios_bolsa → lista de 'chico' | 'grande' | 'edredon'
--
-- Es una LISTA porque la misma bolsa puede servir para más de un servicio (la
-- misma para Chico y Grande, por ejemplo). Vacía = no se precarga en ninguna
-- carga: la bolsa sigue existiendo y se vende a mano.
--
-- Al revés no: un servicio no puede tener dos bolsas activas, porque al
-- precargar habría que adivinar cuál toca. Eso no se puede expresar como índice
-- único sobre un arreglo, así que lo cuida el backend al guardar la bolsa.

BEGIN;

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS servicios_bolsa TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_servicios_bolsa_chk;
ALTER TABLE productos ADD CONSTRAINT productos_servicios_bolsa_chk
  CHECK (servicios_bolsa <@ ARRAY['chico', 'grande', 'edredon']::TEXT[]);

-- Las bolsas que ya existen heredan el mapa viejo, para que la precarga siga
-- funcionando igual sin que nadie tenga que editarlas. Si dos bolsas activas de
-- una sucursal caen en el mismo servicio, solo la primera se lo queda: el resto
-- se deja vacío para que alguien decida.
WITH mapeadas AS (
  SELECT id,
         sucursal,
         CASE tamano_bolsa
           WHEN 'chica'  THEN 'chico'
           WHEN 'grande' THEN 'grande'
           WHEN 'jumbo'  THEN 'edredon'
         END AS servicio
    FROM productos
   WHERE clase = 'bolsa' AND archivado = FALSE
), elegidas AS (
  SELECT id, servicio,
         ROW_NUMBER() OVER (PARTITION BY sucursal, servicio ORDER BY id) AS n
    FROM mapeadas
   WHERE servicio IS NOT NULL
)
UPDATE productos p
   SET servicios_bolsa = ARRAY[e.servicio]
  FROM elegidas e
 WHERE p.id = e.id AND e.n = 1;

COMMIT;
