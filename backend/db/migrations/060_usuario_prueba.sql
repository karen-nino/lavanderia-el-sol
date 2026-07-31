-- Marca de usuario de prueba. Sustituye la detección por nombre: un usuario de
-- prueba se identifica con esta bandera (no por cómo se llame). En la página de
-- Empleados solo los ve el admin_main y no están ligados a una sucursal.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;

-- Conserva la marca para los usuarios de prueba que ya existían (creados por
-- seed_pruebas.js), detectados por el prefijo "Prueba" en el nombre.
UPDATE usuarios SET es_prueba = TRUE WHERE nombre ~* '^prueba([ _-]|$)';
