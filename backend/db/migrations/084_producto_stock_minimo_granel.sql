-- Migración 084: umbral de aviso para el líquido a granel (bidón)
-- ============================================================
-- Igual que stock_minimo (botellas rellenadas), pero para el granel. Se guarda
-- en TAPAS. Cuando el granel disponible cae a este umbral (o menos), el producto
-- se marca "por acabarse". 0 = solo avisa cuando se agota del todo.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS stock_minimo_granel INTEGER NOT NULL DEFAULT 0;
