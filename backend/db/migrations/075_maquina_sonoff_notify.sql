-- Migración 075: notificación central para sincronizar el Sonoff.
-- Fecha: 2026-08-18
--
-- El estado de una máquina cambia desde muchos flujos distintos (crear/editar
-- nota, asignar/quitar/cambiar máquina, terminar lavado/secado, toggles, etc.).
-- En vez de enganchar la sincronización en cada uno, este trigger es el ÚNICO
-- punto: cada vez que cambia lo que afecta al control físico (estado o el
-- enlace device_id/device_canal), emite un pg_notify con el id de la máquina.
-- El backend escucha ese canal (LISTEN) y dispara sincronizarSonoff(id).
--
-- Idempotente: DROP + CREATE, sin datos que migrar.

CREATE OR REPLACE FUNCTION notificar_sync_maquina()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo notifica cuando de verdad cambió algo relevante (o en INSERT).
  IF (TG_OP = 'INSERT')
     OR NEW.estado       IS DISTINCT FROM OLD.estado
     OR NEW.device_id    IS DISTINCT FROM OLD.device_id
     OR NEW.device_canal IS DISTINCT FROM OLD.device_canal
  THEN
    PERFORM pg_notify('maquina_sync', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_sync_maquina ON maquinas;

CREATE TRIGGER trg_notificar_sync_maquina
  AFTER INSERT OR UPDATE OF estado, device_id, device_canal ON maquinas
  FOR EACH ROW EXECUTE FUNCTION notificar_sync_maquina();
