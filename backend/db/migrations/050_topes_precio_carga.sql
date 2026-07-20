-- ============================================================
-- Migración 050: tope de precio por tamaño de carga
-- ============================================================
-- El negocio quiere fijar un precio máximo por carga según su tamaño
-- (chico / grande / jumbo, el tamaño que se captura en Por Encargo).
-- Ej.: tope jumbo $150 con lavadora $60 + secadora $60 deja $30 de
-- presupuesto para productos; al armar la carga no se podrá rebasar.
--
-- NULL = sin tope (comportamiento actual). Los tres arrancan en NULL
-- para que nada cambie hasta que el admin los configure en Ajustes.

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS tope_carga_chico  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tope_carga_grande NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tope_carga_jumbo  NUMERIC(10,2);
