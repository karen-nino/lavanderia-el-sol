-- Migración 149: modelos que trabajan SOLO CON FICHAS
-- Fecha: 2026-10-09
--
-- Hay máquinas sin Sonoff: el cliente les mete fichas y la app no las enciende
-- ni las apaga. Se marcan en el MODELO (Ajustes → Máquinas → Marcas y modelos),
-- igual que "Varios programas", porque es lo que es el aparato.
--
-- Un modelo de fichas:
--   · no pide tiempos: no sale en los bloques de tiempo de Ajustes (ni tope ni
--     minutos por moneda) y al iniciarse se le sella `ciclo_minutos = NULL`,
--     así que nunca llega a un tope ni se le "corta la luz";
--   · en Salidas no lleva "Encender": su único botón es "Iniciar", que solo
--     arranca el cronómetro, y se cierra con "Finalizar carga" como las demás;
--   · la sincronización con el Sonoff la ignora aunque tenga un dispositivo
--     enlazado por error.

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS solo_fichas BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
