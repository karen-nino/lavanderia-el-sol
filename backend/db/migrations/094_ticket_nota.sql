-- Migración 094: nota al pie del ticket
-- ============================================================
-- Texto libre que el negocio escribe en Ajustes → Ticket y que se imprime en
-- letra chica al final de cada ticket (avisos del tipo "conserve su nota").
-- NULL = sin nota, el ticket termina como siempre.

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS ticket_nota TEXT;
