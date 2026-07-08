-- ============================================================
-- Migración 041: descarte de notificaciones por usuario
-- ============================================================
-- El descarte manual de una notificación debe ser independiente para
-- cada usuario: si alguien la descarta, los demás la siguen viendo.
-- La notificación en sí sigue existiendo (auto-expira a 24 h); aquí solo
-- se registra qué usuario la descartó para ocultársela únicamente a él.
-- ============================================================

CREATE TABLE notificacion_descartes (
  notificacion_id INTEGER     NOT NULL REFERENCES notificaciones(id) ON DELETE CASCADE,
  usuario_id      INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notificacion_id, usuario_id)
);
