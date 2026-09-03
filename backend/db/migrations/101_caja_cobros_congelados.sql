-- Migración 101: atar cada cobro a su sesión de caja y congelar los cortes
-- Fecha: 2026-09-03
--
-- Dos problemas del corte, con el mismo origen: las ventas de una sesión no se
-- guardaban en ninguna parte, se volvían a calcular cada vez preguntando "¿qué
-- notas pagadas caen entre la apertura y el cierre?".
--
--   1. Un corte CERRADO cambiaba solo. Revertir el pago de una nota vieja, o
--      editar su total, sacaba esa venta de la ventana y el corte de aquel día
--      aparecía con un faltante (o un sobrante) que nadie causó ese día. Un
--      documento de control que se reescribe solo no sirve para aclarar nada.
--   2. Un cobro hecho SIN caja abierta no entraba en ningún corte y desaparecía
--      del control sin dejar rastro.
--
-- La solución tiene dos mitades:
--   · `notas.caja_id` — a qué sesión de caja pertenece el cobro. Lo pone el
--     mismo trigger que ya fecha el pago, así vale para todas las rutas de
--     cobro. NULL = se cobró sin caja abierta (ahora es visible, no invisible).
--   · Las cifras del corte se copian a `cajas` al cerrarlo. A partir de ahí el
--     historial las lee tal cual, sin recalcular nada.

-- ── 1. Cada cobro sabe en qué caja entró ────────────────────
-- ON DELETE SET NULL: borrar un corte del historial no debe romper las notas.
ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notas_caja ON notas (caja_id) WHERE caja_id IS NOT NULL;

-- Backfill: a las notas ya pagadas se les asigna la caja en cuya ventana cayó
-- su cobro, que es exactamente el criterio que usaba el corte hasta ahora.
UPDATE notas n
   SET caja_id = c.id
  FROM cajas c
 WHERE n.estado_pago = 'PAGADO'
   AND n.caja_id IS NULL
   AND n.pagado_en IS NOT NULL
   AND c.sucursal = n.sucursal
   AND n.pagado_en >= c.abierta_at
   AND n.pagado_en <= COALESCE(c.cerrada_at, NOW());

-- El trigger que ya fechaba el pago ahora también lo ata a su caja.
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
    -- cerrado NO cambia, porque sus cifras quedaron congeladas abajo.
    NEW.pagado_en := NULL;
    NEW.caja_id   := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. El corte guarda sus números al cerrarse ──────────────
-- NULL en estas columnas = corte viejo, anterior a esta migración: el historial
-- lo sigue calculando como antes para no inventarle cifras.
ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS ventas_total         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ventas_efectivo      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ventas_transferencia NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS ventas_tarjeta       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS total_entradas       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS total_salidas        NUMERIC(10,2);
