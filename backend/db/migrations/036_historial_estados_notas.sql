-- ============================================================
-- Migración 036: historial de cambios de estado por nota
-- ============================================================
-- Para mostrar en el Detalle de la nota a qué hora entró en cada
-- estado (En Proceso, Por Procesar, Por Entregar, Finalizada, etc.)
-- se registra cada transición en nota_estado_historial.
--
-- Se usa un trigger en lugar de tocar cada UPDATE de la app porque el
-- estado cambia desde varias rutas (creación, asignar máquina, promoción
-- automática a POR_PROCESAR, endpoint de estado, y el job de cierre del
-- día). El trigger garantiza que todas queden registradas.

CREATE TABLE nota_estado_historial (
  id          SERIAL PRIMARY KEY,
  nota_id     INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  estado      estado_orden NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nota_estado_historial_nota ON nota_estado_historial(nota_id, created_at);

-- Semilla para notas existentes: se registra la creación (EN_ESPERA al
-- momento de created_at) y, si la nota ya avanzó, su estado actual al
-- momento de updated_at. Los estados intermedios de notas antiguas no se
-- pueden reconstruir; las notas nuevas sí tendrán el historial completo.
INSERT INTO nota_estado_historial (nota_id, estado, created_at)
  SELECT id, 'EN_ESPERA', created_at FROM notas;

INSERT INTO nota_estado_historial (nota_id, estado, created_at)
  SELECT id, estado, updated_at FROM notas WHERE estado <> 'EN_ESPERA';

-- Trigger: registra el estado en cada INSERT y cuando cambia en un UPDATE.
CREATE OR REPLACE FUNCTION registrar_estado_nota() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') OR (NEW.estado IS DISTINCT FROM OLD.estado) THEN
    INSERT INTO nota_estado_historial (nota_id, estado) VALUES (NEW.id, NEW.estado);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registrar_estado_nota
  AFTER INSERT OR UPDATE OF estado ON notas
  FOR EACH ROW EXECUTE FUNCTION registrar_estado_nota();
