-- ============================================================
-- Migración 053: tiempo de ciclo para el lavado de Edredón
-- ============================================================
-- Hasta ahora el lavado de edredón (siempre en lavadora jumbo) reusaba el
-- tiempo de ciclo del jumbo. Se le da su propio tiempo configurable, para
-- que el temporizador refleje una duración distinta cuando la lavadora
-- jumbo está lavando un edredón.
--
-- Se siembra con el tiempo del jumbo actual para no cambiar nada hasta que
-- el admin lo ajuste en Ajustes → Máquinas → Lavadora → Edredón.
ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS tiempo_edredon_jumbo INTEGER;

UPDATE ajustes
   SET tiempo_edredon_jumbo = COALESCE(tiempo_edredon_jumbo, tiempo_carga_jumbo)
 WHERE id = 1;

ALTER TABLE ajustes
  ALTER COLUMN tiempo_edredon_jumbo SET DEFAULT 45;
