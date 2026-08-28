-- Migración 090: tarjeta como forma de pago, y forma de pago en TODO cobro
-- Fecha: 2026-08-27
--
-- Dos cambios sobre notas.forma_pago (mig. 078):
--
-- 1) Se agrega 'TARJETA' a las formas válidas. Para el corte de caja la
--    tarjeta se comporta como la transferencia: el cobro es real pero el
--    dinero NO entra al cajón.
--
-- 2) Antes forma_pago solo se llenaba en el pago anticipado (al crear la
--    nota). El cobro normal —marcar la nota como pagada al entregarla— no la
--    registraba, así que la mayoría de las notas quedaban en NULL y el corte
--    contaba transferencias como si fueran efectivo. A partir de ahora la
--    captura también el endpoint de estado de pago.
--
-- Las notas ya pagadas que quedaron con forma_pago NULL se dan por EFECTIVO:
-- es lo que el corte asumía implícitamente hasta hoy, así que los cortes
-- históricos no cambian de resultado. NULL sigue siendo válido para las notas
-- pendientes (aún no se cobran, todavía no hay forma de pago).

ALTER TABLE notas DROP CONSTRAINT IF EXISTS notas_forma_pago_check;

UPDATE notas
   SET forma_pago = 'EFECTIVO'
 WHERE estado_pago = 'PAGADO'
   AND forma_pago IS NULL;

ALTER TABLE notas
  ADD CONSTRAINT notas_forma_pago_check
  CHECK (forma_pago IS NULL OR forma_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA'));
