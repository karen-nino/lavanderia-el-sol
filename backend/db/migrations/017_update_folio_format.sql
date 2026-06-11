-- Migración 017: nuevo formato de folio
-- Viejo: LS-YYYYMMDD-NNNN  (ej. LS-20260611-0039)
-- Nuevo: NNNN-DDMMYYYY     (ej. 0039-11062026)
-- Fecha: 2026-06-11

UPDATE notas
SET folio = SUBSTRING(folio FROM 13) || '-' ||
            SUBSTRING(folio FROM 10 FOR 2) ||  -- DD
            SUBSTRING(folio FROM 8  FOR 2) ||  -- MM
            SUBSTRING(folio FROM 4  FOR 4)     -- YYYY
WHERE folio LIKE 'LS-%';
