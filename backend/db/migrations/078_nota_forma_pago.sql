-- Migración 078: forma de pago de la nota
-- Fecha: 2026-08-20
--
-- Registra CÓMO se pagó una nota cuando el pago es anticipado: efectivo o
-- transferencia. NULL = aún no pagado (a deber) o no se capturó. Útil para el
-- corte de caja y reportes.

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS forma_pago TEXT
    CHECK (forma_pago IS NULL OR forma_pago IN ('EFECTIVO', 'TRANSFERENCIA'));
