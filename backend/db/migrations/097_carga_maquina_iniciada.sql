-- Migración 097: marcar cuándo una carga arrancó de verdad su máquina
-- Fecha: 2026-09-02
--
-- Asignar una máquina dejó de apartarla: varias notas pueden tener la misma
-- lavadora asignada y se la queda la primera que le da a "Iniciar". Eso volvió
-- ambiguo el `lavadora_id` de la carga, que hasta ahora significaba a la vez
-- "la tengo asignada" y "la estoy usando":
--
--   · cancelar o borrar una nota que solo la tenía asignada apagaba la máquina
--     que OTRA nota estaba usando (con Sonoff, a media lavada);
--   · el reporte de uso contaba como uso todas las notas que la tuvieran
--     asignada, inflando ciclos y dinero atribuido a esa máquina.
--
-- Con estas dos marcas la diferencia queda explícita: se llenan al arrancar la
-- máquina y NULL significa "asignada pero nunca arrancada".

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS lavadora_iniciada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS secadora_iniciada_at TIMESTAMPTZ;

-- Backfill: hasta ahora una máquina solo podía estar en una nota, así que toda
-- carga con máquina (viva o ya usada) de una nota no cancelada sí la usó. Se
-- fecha con la creación de la nota, que es lo más cercano que existe.
UPDATE nota_cargas nc
   SET lavadora_iniciada_at = n.created_at
  FROM notas n
 WHERE n.id = nc.nota_id
   AND n.estado <> 'CANCELADA'
   AND nc.lavadora_iniciada_at IS NULL
   AND COALESCE(nc.lavadora_id, nc.lavadora_usada_id) IS NOT NULL;

UPDATE nota_cargas nc
   SET secadora_iniciada_at = n.created_at
  FROM notas n
 WHERE n.id = nc.nota_id
   AND n.estado <> 'CANCELADA'
   AND nc.secadora_iniciada_at IS NULL
   AND COALESCE(nc.secadora_id, nc.secadora_usada_id) IS NOT NULL;
