-- Marca de máquina "eliminada" por carga: cuando se quita una máquina asignada
-- pero sin iniciar, se conserva su referencia en lavadora_usada_id /
-- secadora_usada_id y se marca removida = TRUE, para mostrar una línea tachada
-- (gris) indicando que estuvo asignada y se eliminó. Distingue "eliminada" de
-- "terminó su ciclo" (usada con removida = FALSE).
ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS lavadora_removida BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS secadora_removida BOOLEAN NOT NULL DEFAULT FALSE;
