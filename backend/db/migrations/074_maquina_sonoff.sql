-- Migración 074: enlace de cada máquina con su dispositivo Sonoff
-- Fecha: 2026-08-18
--
-- Fase 1 de la integración Sonoff (solo encender/apagar vía nube eWeLink).
-- La app hoy controla las máquinas de forma manual (cambia maquinas.estado en
-- la BD); estas columnas permiten reflejar ese estado en el hardware.
--
--   device_id     — identificador del Sonoff en eWeLink (NULL = sin enlazar).
--   device_canal  — canal/relé dentro del dispositivo (para Sonoff multi-relé;
--                   NULL o 0 para los de un solo relé).
--   sonoff_estado — último estado conocido del enlace, para el indicador de la
--                   tarjeta: 'sin_enlazar' (no tiene device_id),
--                   'enlazada' (respondió y coincide con la BD),
--                   'error' (tiene device_id pero no respondió / desincronizado).
--   sonoff_sync_at — cuándo se actualizó por última vez sonoff_estado.
--
-- El estado real lo escribe el reconciliador (job periódico) y el servicio
-- sincronizarSonoff(); aquí solo se crean las columnas con el valor inicial.

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS device_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS device_canal   SMALLINT,
  ADD COLUMN IF NOT EXISTS sonoff_estado  VARCHAR(20) NOT NULL DEFAULT 'sin_enlazar'
    CHECK (sonoff_estado IN ('sin_enlazar', 'enlazada', 'error')),
  ADD COLUMN IF NOT EXISTS sonoff_sync_at TIMESTAMPTZ;
