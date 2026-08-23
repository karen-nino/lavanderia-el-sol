-- Migración 081: historial de movimientos de stock de productos
-- ============================================================
-- Cada cambio de existencias queda registrado: entradas (compra), salidas
-- (derrame/rotura/regalo/corrección), rellenados (bidón → botellas), ventas y
-- reservas al usarse en una nota, y ajustes manuales. Todo en TAPAS (la unidad
-- interna); `descripcion` guarda el texto amigable ("15 botellas", "1 bidón").
--   • destino → sobre qué existencia impacta: 'granel' (bidón) o 'botellas'.
--   • nota_id → si el movimiento vino de una venta/uso en una nota.

CREATE TABLE IF NOT EXISTS producto_movimientos (
  id             SERIAL PRIMARY KEY,
  producto_id    INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sucursal       VARCHAR(50) NOT NULL,
  usuario_id     INTEGER REFERENCES usuarios(id),
  tipo           TEXT NOT NULL CHECK (tipo IN
                   ('entrada', 'salida', 'rellenar', 'venta', 'reserva', 'liberacion', 'ajuste')),
  destino        TEXT NOT NULL CHECK (destino IN ('granel', 'botellas')),
  cantidad_tapas INTEGER NOT NULL,
  descripcion    TEXT,
  motivo         TEXT,
  nota_id        INTEGER REFERENCES notas(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prod_mov_producto ON producto_movimientos(producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_mov_sucursal ON producto_movimientos(sucursal);
