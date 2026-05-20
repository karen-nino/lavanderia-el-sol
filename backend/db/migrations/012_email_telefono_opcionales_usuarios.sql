-- Migración 012: email y telefono opcionales en usuarios
-- (la página Empleados ya no captura estos datos; el login usa id + password)

ALTER TABLE usuarios ALTER COLUMN email    DROP NOT NULL;
ALTER TABLE usuarios ALTER COLUMN telefono DROP NOT NULL;
