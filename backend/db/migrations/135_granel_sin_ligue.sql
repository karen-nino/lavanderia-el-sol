-- Migración 135: el granel ya no se liga a servicios
-- ============================================================
-- En la 131 cada granel líquido decía a qué servicios Por Encargo iba ligado.
-- En la práctica todos sirven para todos: lo que importa es su TIPO (mig. 133).
-- Desde aquí cualquier granel líquido con tipo es opción en cualquier servicio,
-- y la columna sobra. La bolsa conserva su ligue (servicios_bolsa, mig. 125).

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_servicios_precarga_chk;
ALTER TABLE productos DROP COLUMN IF EXISTS servicios_precarga;
