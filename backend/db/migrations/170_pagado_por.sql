-- Migración 170: quién cobró una nota pagada en un solo cobro
-- Fecha: 2026-11-06
--
-- Con pago completo (al crear la nota o al marcarla pagada) no nace abono, así
-- que el detalle no decía quién cobró. `pagado_en` ya guarda cuándo; aquí se
-- agrega quién. El trigger lo limpia junto con `pagado_en` al revertir.

ALTER TABLE notas ADD COLUMN IF NOT EXISTS pagado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;

-- Notas ya pagadas sin abonos y cobradas al crearlas: cobró quien las creó.
UPDATE notas n
   SET pagado_por = n.usuario_id
 WHERE n.estado_pago = 'PAGADO'
   AND n.pagado_en IS NOT NULL
   AND n.pagado_en <= n.created_at + INTERVAL '1 minute'
   AND NOT EXISTS (SELECT 1 FROM nota_abonos a WHERE a.nota_id = n.id);

CREATE OR REPLACE FUNCTION registrar_pago_nota() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado_pago = 'PAGADO' THEN
    IF (TG_OP = 'INSERT') OR (OLD.estado_pago IS DISTINCT FROM 'PAGADO') THEN
      IF NEW.pagado_en IS NULL THEN
        NEW.pagado_en := NOW();
      END IF;
      -- Caja abierta de la sucursal de la nota. Si no hay ninguna, queda NULL:
      -- el cobro ocurrió fuera de toda sesión y así se puede reportar.
      IF NEW.caja_id IS NULL THEN
        SELECT c.id INTO NEW.caja_id
          FROM cajas c
         WHERE c.estado = 'abierta' AND c.sucursal = NEW.sucursal
         LIMIT 1;
      END IF;
    END IF;
  ELSE
    -- Se revierte el pago: la nota deja de pertenecer a esa caja. El corte ya
    -- cerrado NO cambia, porque sus cifras quedaron congeladas.
    NEW.pagado_en  := NULL;
    NEW.caja_id    := NULL;
    NEW.pagado_por := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
