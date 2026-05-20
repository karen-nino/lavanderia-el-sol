-- Migración 014: promover al admin existente a Admin Main
-- Convierte únicamente a los usuarios que hoy tienen rol = 'admin'.
-- Los nuevos administradores creados después seguirán siendo 'admin' regular.

UPDATE usuarios SET rol = 'admin_main' WHERE rol = 'admin';
