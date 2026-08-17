-- Migración 072: renombrar "modalidad" a "tipo de servicio".
-- ============================================================
-- El frontend ya usaba el vocabulario "tipo de servicio" (estado tipoServicio,
-- label "Tipo de Servicio"), pero la BD y los payloads seguían con "modalidad".
-- Se unifica todo. El sistema aún no está en uso, así que no hay datos que
-- migrar: rename directo de columna, tipo enum e índice. Los VALORES del enum
-- (AUTOSERVICIO / EDREDON / POR_ENCARGO) NO cambian.

ALTER TABLE notas RENAME COLUMN modalidad TO tipo_servicio;
ALTER TYPE modalidad_orden RENAME TO tipo_servicio;
ALTER INDEX IF EXISTS idx_ordenes_modalidad RENAME TO idx_notas_tipo_servicio;
