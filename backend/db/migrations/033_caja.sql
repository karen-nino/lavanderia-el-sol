-- ============================================================
-- Migración 033: Caja (apertura, movimientos, corte, historial)
-- ============================================================
-- Caja compartida: una sola sesión abierta a la vez para todo el
-- negocio. Reutiliza el enum existente tipo_movimiento (entrada|salida).

CREATE TYPE estado_caja AS ENUM ('abierta', 'cerrada');

-- ── Sesiones de caja ─────────────────────────────────────────
CREATE TABLE cajas (
  id                   SERIAL PRIMARY KEY,
  usuario_apertura_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  usuario_cierre_id    INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  estado               estado_caja NOT NULL DEFAULT 'abierta',
  monto_inicial        NUMERIC(10,2) NOT NULL DEFAULT 0,   -- fondo de caja
  monto_contado        NUMERIC(10,2),                       -- efectivo contado al cierre
  notas_apertura       TEXT,
  notas_cierre         TEXT,
  abierta_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrada_at           TIMESTAMPTZ,
  CONSTRAINT monto_inicial_no_negativo CHECK (monto_inicial >= 0)
);

-- Garantiza UNA sola caja abierta a la vez (caja compartida)
CREATE UNIQUE INDEX idx_una_caja_abierta ON cajas (estado) WHERE estado = 'abierta';

-- ── Movimientos de efectivo dentro de una sesión ─────────────
CREATE TABLE movimientos_caja (
  id          SERIAL PRIMARY KEY,
  caja_id     INTEGER NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo        tipo_movimiento NOT NULL,            -- 'entrada' | 'salida'
  concepto    VARCHAR(200) NOT NULL,
  monto       NUMERIC(10,2) NOT NULL CHECK (monto > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movimientos_caja ON movimientos_caja(caja_id);
