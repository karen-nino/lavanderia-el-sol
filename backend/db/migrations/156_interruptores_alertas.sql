-- Migración 156: más alertas que se encienden o apagan desde Ajustes
-- Fecha: 2026-10-10
--
-- Hasta ahora solo "ciclo detenido" (`alerta_ciclo_detenido`) tenía su
-- interruptor. Se agregan los de las alertas que no son de control (las de
-- dinero y borrados —nota cancelada/eliminada, pago revertido o desmarcado—
-- siempre quedan, a propósito: son el rastro de quién hizo qué):
--   · `alerta_stock`             → campana: producto por agotarse/agotado y
--                                  granel bajo;
--   · `alerta_encendido_manual`  → campana: el Sonoff encontró una máquina
--                                  prendida a mano;
--   · `alerta_tope_maquina`      → campana: una máquina llegó a su tope y se
--                                  le cortó la luz (el corte sigue igual);
--   · `aviso_sonoro_ciclo`       → el sonido de fin de ciclo / tope.
-- Todas nacen encendidas: nada cambia hasta que alguien las apague.

BEGIN;

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS alerta_stock            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alerta_encendido_manual BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alerta_tope_maquina     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aviso_sonoro_ciclo      BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
