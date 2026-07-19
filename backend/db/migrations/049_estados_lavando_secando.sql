-- ============================================================
-- Migración 049: dividir EN_PROCESO en LAVANDO / SECANDO y
--                eliminar POR_PROCESAR del enum estado_orden
-- ============================================================
-- El estado "En Proceso" se divide según la fase real de la nota:
--   LAVANDO — conserva alguna lavadora vinculada (cargas o columna
--             legada maquina_id). terminar-lavado desvincula la
--             lavadora, así que su presencia implica lavado en curso.
--   SECANDO — ya no le quedan lavadoras; solo secadoras trabajando.
-- POR_PROCESAR desaparece (y con él la promoción automática por
-- tiempo de ciclo): la nota permanece en LAVANDO/SECANDO hasta que
-- el empleado termina el ciclo (terminar-lavado / terminar-secado).
--
-- Postgres no permite quitar valores de un enum, así que se pasan
-- las columnas a texto, se remapean los datos y se recrea el tipo.

-- El trigger de historial se suelta durante el remapeo (su definición
-- "UPDATE OF estado" bloquea el cambio de tipo de la columna y además
-- registraría transiciones falsas con fecha de hoy); se recrea al final.
DROP TRIGGER trg_registrar_estado_nota ON notas;

ALTER TABLE notas ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE notas ALTER COLUMN estado TYPE text;
ALTER TABLE nota_estado_historial ALTER COLUMN estado TYPE text;

UPDATE notas n
   SET estado = CASE
     WHEN n.maquina_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM nota_cargas nc
                   WHERE nc.nota_id = n.id AND nc.lavadora_id IS NOT NULL)
       THEN 'LAVANDO'
     WHEN n.secadora_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM nota_cargas nc
                   WHERE nc.nota_id = n.id AND nc.secadora_id IS NOT NULL)
       THEN 'SECANDO'
     -- Sin máquinas vinculadas: fase inicial del proceso.
     ELSE 'LAVANDO'
   END
 WHERE n.estado IN ('EN_PROCESO', 'POR_PROCESAR');

-- Historial: EN_PROCESO marcaba el arranque del proceso (lavado);
-- POR_PROCESAR, el fin del ciclo de máquinas (lo más cercano al secado).
UPDATE nota_estado_historial SET estado = 'LAVANDO' WHERE estado = 'EN_PROCESO';
UPDATE nota_estado_historial SET estado = 'SECANDO' WHERE estado = 'POR_PROCESAR';

DROP TYPE estado_orden;
CREATE TYPE estado_orden AS ENUM
  ('EN_ESPERA', 'LAVANDO', 'SECANDO', 'LISTA', 'PAGADA', 'FINALIZADA', 'CANCELADA');

ALTER TABLE notas
  ALTER COLUMN estado TYPE estado_orden USING estado::estado_orden,
  ALTER COLUMN estado SET DEFAULT 'LAVANDO';
ALTER TABLE nota_estado_historial
  ALTER COLUMN estado TYPE estado_orden USING estado::estado_orden;

-- Misma definición que en la migración 036.
CREATE TRIGGER trg_registrar_estado_nota
  AFTER INSERT OR UPDATE OF estado ON notas
  FOR EACH ROW EXECUTE FUNCTION registrar_estado_nota();
