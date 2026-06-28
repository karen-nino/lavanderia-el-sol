-- ============================================================
-- Migración 034: agregar estado POR_PROCESAR al enum estado_orden
-- ============================================================
-- Cuando una máquina termina su tiempo de lavado, la nota deja de
-- estar "En Proceso" y pasa a "Por Procesar" (carga lista para sacar
-- de la máquina). El servidor es la fuente de verdad: promueve la
-- nota automáticamente al leerse (ver promoverNotasPorProcesar en
-- notas.controller). El Dashboard solo refleja este estado.
-- Se ubica justo después de EN_PROCESO para conservar el orden lógico
-- de avance (En Espera → En Proceso → Por Procesar → Lista → ...).

ALTER TYPE estado_orden ADD VALUE IF NOT EXISTS 'POR_PROCESAR' AFTER 'EN_PROCESO';
