-- ============================================================
-- Migración 102: historial de correcciones de forma de pago
-- ============================================================
-- Un admin puede corregir la forma de pago de una nota ya cobrada cuando el
-- empleado la registró mal (marcó efectivo y el cliente pagó por transferencia).
-- Eso mueve dinero entre columnas del corte de caja y de Ventas, así que tiene
-- que quedar rastro de quién lo cambió y cuándo.
--
-- No se usa un trigger (como en nota_estado_historial): aquí interesa QUIÉN
-- hizo la corrección, y el usuario solo se conoce en el controlador. Es además
-- el único sitio que cambia `forma_pago` de una nota ya cobrada.

CREATE TABLE nota_forma_pago_historial (
  id             SERIAL PRIMARY KEY,
  nota_id        INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  forma_anterior VARCHAR(20),
  forma_nueva    VARCHAR(20) NOT NULL,
  -- Si se borra al empleado no se pierde el registro del cambio.
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nota_forma_pago_hist_nota ON nota_forma_pago_historial(nota_id, created_at);
-- Ventas lista las correcciones de un período: se filtra por fecha.
CREATE INDEX idx_nota_forma_pago_hist_fecha ON nota_forma_pago_historial(created_at);
