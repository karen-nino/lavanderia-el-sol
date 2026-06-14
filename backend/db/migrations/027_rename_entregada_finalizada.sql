-- ============================================================
-- Migración 027: renombrar valor ENTREGADA → FINALIZADA en enum estado_orden
-- ============================================================

ALTER TYPE estado_orden RENAME VALUE 'ENTREGADA' TO 'FINALIZADA';
