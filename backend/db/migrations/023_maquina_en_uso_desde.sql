-- Migración 023: en_uso_desde para temporizador de máquinas
-- Fecha: 2026-06-13
--
-- Marca el instante en que la máquina pasó a estado en_uso.
-- Se setea al cambiar a en_uso y se limpia al salir de ese estado.

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS en_uso_desde TIMESTAMP NULL;

-- Para máquinas que ya estaban en uso antes de la migración,
-- asume que arrancan justo ahora; eso evita mostrar "00:00" desde el inicio.
UPDATE maquinas SET en_uso_desde = NOW() WHERE estado = 'en_uso' AND en_uso_desde IS NULL;
