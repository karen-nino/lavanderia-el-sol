-- Migración 022: tiempos de carga por tipo de máquina (mediana / jumbo)
-- Fecha: 2026-06-13
--
-- Guarda en minutos cuánto dura un ciclo de carga en cada tipo de máquina.
-- Defaults orientativos: 30 min mediana, 45 min jumbo.

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS tiempo_carga_mediana INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS tiempo_carga_jumbo   INTEGER NOT NULL DEFAULT 45;
