-- Migración 140: cuánto tiempo estuvo encendida cada máquina de una nota
-- Fecha: 2026-10-03
--
-- Ventas → modal de Máquinas de una nota decía solo cuántas cargas corrió cada
-- máquina. El negocio pidió ver también cuánto tiempo estuvo encendida, desde
-- que arrancó hasta que alguien le dio "Finalizar".
--
-- `maquinas.en_uso_desde` ya guarda el arranque, pero se borra al liberarla, y
-- `nota_cargas.*_iniciada_at` solo guarda el PRIMER arranque de la carga (una
-- segunda vuelta no lo mueve). Por eso se sella en la pasada (mig. 114), que es
-- una fila por vuelta: al finalizar se copian ahí el arranque y la hora de fin.
--
-- Solo lo llenan los tres caminos de Finalizar (terminar-lavado,
-- terminar-lavado-final, terminar-secado). Una máquina que se suelta por otro
-- lado (cancelar la nota, cierre del día) queda en NULL: no se finalizó, y
-- contar ese tiempo mentiría. Las pasadas anteriores a esta migración también
-- quedan en NULL: no hay de dónde sacar su hora de fin.

ALTER TABLE nota_carga_maquinas
  ADD COLUMN IF NOT EXISTS encendida_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalizada_at TIMESTAMPTZ;
