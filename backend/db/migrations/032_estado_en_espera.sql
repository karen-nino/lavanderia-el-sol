-- ============================================================
-- Migración 032: agregar estado EN_ESPERA al enum estado_orden
-- ============================================================
-- Una nota "Por Encargo" creada sin activar inmediatamente una
-- máquina queda "En Espera" hasta que se ponga en proceso.
-- Se ubica antes de EN_PROCESO para conservar el orden lógico
-- de avance (En Espera → En Proceso → Lista → Pagada → Finalizada).

ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'EN_ESPERA' BEFORE 'EN_PROCESO';
