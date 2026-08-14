-- Migración 070: hora de salida (cierre de sesión manual) en el check-in
-- ============================================================
-- Además de la entrada (primer login del día = created_at), se registra la
-- SALIDA: el momento en que el empleado cierra sesión manualmente. Se guarda
-- en la fila del día correspondiente; si cierra sesión varias veces, queda la
-- última. Nullable: los días sin cierre manual no tienen salida.

ALTER TABLE checkins ADD COLUMN IF NOT EXISTS salida TIMESTAMPTZ;
