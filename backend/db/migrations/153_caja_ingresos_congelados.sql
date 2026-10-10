-- Migración 153: los Ingresos y el "SPE Debe" del corte se congelan al cerrar
-- Fecha: 2026-10-10
--
-- El corte enseña de dónde salió el efectivo del turno (Ingresos: lavadoras
-- medianas, jumbo, secadoras, productos, SPE y edredón) y lo que dejó por
-- cobrar en Por Encargo (Egresos → "SPE Debe"). Igual que las demás cifras del
-- corte (mig. 101), se COPIAN al cerrar para que el historial, Ventas y las
-- exportaciones los lean tal cual:
--   · `ingresos_detalle`: el reparto del efectivo, como lo devuelve
--     `ingresosDeSesion` ({ lavadoras_medianas, lavadoras_jumbo, secadoras,
--     productos, por_encargo, edredon });
--   · `spe_debe`: el saldo de las notas Por Encargo creadas en el turno que
--     seguían sin liquidar al cerrarlo. Este SÍ cambia con el tiempo (la nota
--     se paga después), por eso tiene que quedar la foto del cierre.
--
-- NULL en los cortes de antes: el reparto se recalcula al leerlos (el dinero
-- de una caja cerrada ya no se mueve) y el SPE Debe no se muestra (ya no hay
-- forma de saber cuánto se debía aquel día).

BEGIN;

ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS ingresos_detalle JSONB,
  ADD COLUMN IF NOT EXISTS spe_debe         NUMERIC(10,2) CHECK (spe_debe >= 0);

COMMIT;
