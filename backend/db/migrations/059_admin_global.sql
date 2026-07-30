-- Un administrador (admin / admin_main) es global: no está ligado a una
-- sucursal. Se permite NULL en usuarios.sucursal para representarlo y se
-- desvincula a los administradores existentes. Los empleados (operador)
-- siguen requiriendo una sucursal a nivel de aplicación.
ALTER TABLE usuarios ALTER COLUMN sucursal DROP NOT NULL;

UPDATE usuarios SET sucursal = NULL WHERE rol IN ('admin', 'admin_main');
