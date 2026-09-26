-- Migración 121: abonos (pagos parciales) de una nota
-- Fecha: 2026-09-25
--
-- Por Encargo el cliente deja la ropa y a veces adelanta una parte: "le dejo
-- $100 y el resto cuando la recoja". Hasta ahora una nota solo podía estar
-- PENDIENTE o PAGADA, así que ese dinero no tenía dónde registrarse y acababa
-- fuera del sistema o cobrado de más.
--
-- Cada abono es dinero que ENTRÓ el día que se hizo, así que se guarda con su
-- caja: el corte de ese día lo cuenta, y al liquidar la nota solo entra lo que
-- faltaba. Así cada peso se cuenta una sola vez y en el corte que le toca.
--
-- Un abono mal capturado no se borra: se marca revertido con su motivo y quién
-- lo hizo, igual que la reversión de un pago (solo admin y con la caja de ese
-- abono todavía abierta). Los revertidos dejan de sumar en todas partes.

BEGIN;

CREATE TABLE IF NOT EXISTS nota_abonos (
  id               SERIAL PRIMARY KEY,
  nota_id          INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  -- La caja donde entró el dinero. NULL = se abonó sin caja abierta.
  caja_id          INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
  usuario_id       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  monto            NUMERIC(10,2) NOT NULL CHECK (monto > 0),
  forma_pago       VARCHAR(20) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Reversión: el abono se conserva para que quede el rastro.
  revertido_at     TIMESTAMPTZ,
  revertido_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_reversion TEXT
);

CREATE INDEX IF NOT EXISTS idx_nota_abonos_nota ON nota_abonos(nota_id);
-- Los cortes preguntan por los abonos VIVOS de una caja.
CREATE INDEX IF NOT EXISTS idx_nota_abonos_caja
  ON nota_abonos(caja_id) WHERE revertido_at IS NULL;

COMMIT;
