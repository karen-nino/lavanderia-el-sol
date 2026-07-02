-- ============================================================
-- Migración 037: columna pagado_en para atribuir el ingreso al
-- día real del cobro
-- ============================================================
-- Antes "Ingresado" se medía por created_at (día de creación de la
-- nota). Para que el ingreso se atribuya al momento en que el cliente
-- efectivamente pagó, se agrega pagado_en: se llena cuando estado_pago
-- pasa a 'PAGADO' y se limpia si el pago se revierte.
--
-- Se usa un trigger en lugar de tocar cada INSERT/UPDATE de la app
-- porque el pago se registra desde varias rutas (creación, edición de
-- nota). El trigger garantiza que pagado_en quede siempre consistente.

ALTER TABLE notas ADD COLUMN IF NOT EXISTS pagado_en TIMESTAMPTZ;

-- Semilla para notas ya pagadas: se usa created_at como mejor
-- aproximación disponible (no existe registro histórico del cobro).
UPDATE notas
   SET pagado_en = created_at
 WHERE estado_pago = 'PAGADO' AND pagado_en IS NULL;

-- Trigger: mantiene pagado_en en sincronía con estado_pago.
CREATE OR REPLACE FUNCTION registrar_pago_nota() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado_pago = 'PAGADO' THEN
    -- Se marca el momento del pago solo al pasar a PAGADO (o al crear
    -- una nota ya pagada), sin sobrescribir un pago previo.
    IF (TG_OP = 'INSERT') OR (OLD.estado_pago IS DISTINCT FROM 'PAGADO') THEN
      IF NEW.pagado_en IS NULL THEN
        NEW.pagado_en := NOW();
      END IF;
    END IF;
  ELSE
    -- Si el pago se revierte, se descarta la fecha de cobro.
    NEW.pagado_en := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registrar_pago_nota
  BEFORE INSERT OR UPDATE ON notas
  FOR EACH ROW
  EXECUTE FUNCTION registrar_pago_nota();
