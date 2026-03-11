-- Agrega columna folio a ordenes para almacenar el folio generado automáticamente
-- Formato: LS-YYYYMMDD-XXXX (ej. LS-20240315-0001)
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS folio VARCHAR(20) UNIQUE;
