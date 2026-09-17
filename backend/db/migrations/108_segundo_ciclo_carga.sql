-- Migración 108: una carga puede correr más de un ciclo en la misma máquina
-- Fecha: 2026-09-17
--
-- El ciclo real de las LG son 15 min, y una carga de ropa necesita dos ciclos
-- seguidos. Hasta ahora el sistema daba por terminada la carga cuando se
-- cumplía el tiempo sellado: a los 15 min la tarjeta ofrecía cerrarla y el
-- corte por fin de ciclo le quitaba la corriente, de modo que el segundo ciclo
-- solo se podía dar con el botón de encendido manual de Gestión, que es de
-- admin. En el mostrador eso deja al empleado sin salida.
--
-- Ahora el empleado puede re-armar la máquina para otro ciclo. Lo que se
-- guarda aquí es CUÁNTOS ciclos lleva cada carga, por dos razones:
--
--   · es el tope: sin contador nada impide re-armar indefinidamente y lavar
--     gratis con una sola nota cobrada;
--   · es el registro: el reporte de uso cuenta cargas, y una carga de dos
--     ciclos gasta el doble de agua y luz que una de uno.
--
-- Arranca en 1 porque toda carga ya iniciada corrió su primer ciclo; el
-- contador sube al re-armar, no al arrancar.

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS lavadora_ciclos INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS secadora_ciclos INTEGER NOT NULL DEFAULT 1;

ALTER TABLE nota_cargas
  DROP CONSTRAINT IF EXISTS nota_cargas_ciclos_positivos,
  ADD  CONSTRAINT nota_cargas_ciclos_positivos
       CHECK (lavadora_ciclos >= 1 AND secadora_ciclos >= 1);
