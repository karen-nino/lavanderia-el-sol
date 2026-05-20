-- Migración 013: agregar valor 'admin_main' al enum rol_usuario
-- NOTA: debe correrse antes de la migración 014 (Postgres no permite usar
-- un valor de enum recién agregado en la misma transacción).

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'admin_main';
