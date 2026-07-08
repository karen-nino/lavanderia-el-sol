-- ============================================================
-- Migración 040: alerta de "ciclo detenido" + notificaciones
-- ============================================================
-- Nuevo ajuste (on/off): si está activo, cuando alguien detiene
-- manualmente el ciclo de una máquina (botón "Detener ciclo") se
-- registra una notificación que aparece en la campana del Dashboard.
--
-- Las notificaciones son eventos puntuales; la campana muestra solo
-- las de las últimas 24 h (se "descartan" solas por antigüedad).
-- ============================================================

ALTER TABLE ajustes
  ADD COLUMN alerta_ciclo_detenido BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE notificaciones (
  id          SERIAL PRIMARY KEY,
  tipo        VARCHAR(40) NOT NULL,
  mensaje     TEXT        NOT NULL,
  maquina_id  INTEGER     REFERENCES maquinas(id) ON DELETE SET NULL,
  usuario_id  INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  sucursal    VARCHAR(50) NOT NULL REFERENCES sucursales(slug),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificaciones_sucursal_fecha
  ON notificaciones (sucursal, created_at DESC);
