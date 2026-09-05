-- ============================================================
-- Migración 104: encendido manual de una máquina
-- ============================================================
-- El reconciliador toma `maquinas.estado` como verdad y apaga todo lo que no
-- esté 'en_uso'. Eso mata, en menos de 3 minutos, cualquier máquina que alguien
-- haya prendido a mano: con el botón "Encender" de Gestión (que no cambiaba el
-- estado) o directamente desde la app de eWeLink. Con ropa dentro.
--
-- Ahora un encendido manual deja huella aquí. Mientras la huella esté vigente:
--   · el reconciliador NO la apaga (la afirma encendida, como a una nota);
--   · la máquina queda 'en_uso', así que no se ofrece al crear notas ni en
--     Salidas — está ocupada de verdad, aunque no haya nota detrás.
--
-- La huella caduca (SONOFF_ENCENDIDO_MANUAL_HORAS, 3 h por defecto) para que
-- una máquina que alguien prendió y olvidó no quede apartada para siempre: al
-- vencer, vuelve a 'disponible' y el reconciliador la apaga.

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS encendida_manual_at TIMESTAMPTZ;

COMMENT ON COLUMN maquinas.encendida_manual_at IS
  'Cuándo se prendió a mano (botón Encender o desde eWeLink). NULL = no hay encendido manual vigente.';
