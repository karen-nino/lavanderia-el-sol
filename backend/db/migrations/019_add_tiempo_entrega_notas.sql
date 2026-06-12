-- Migración 019: agregar columna tiempo_entrega a notas
-- Valores esperados: 'MANANA' | 'TARDE' | 'NOCHE' | NULL
-- Fecha: 2026-06-11

ALTER TABLE notas ADD COLUMN IF NOT EXISTS tiempo_entrega VARCHAR(10);
