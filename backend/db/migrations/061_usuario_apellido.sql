-- Separa el nombre del empleado en dos columnas, como en clientes: `nombre`
-- (nombres de pila, hasta 3 palabras) y `apellido` (apellidos, hasta 2).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);

-- Backfill de los registros existentes: la primera palabra queda como nombre y
-- el resto como apellido (mismo criterio que usaba la app al mostrar el nombre).
UPDATE usuarios
SET apellido = NULLIF(regexp_replace(trim(nombre), '^\S+\s*', ''), ''),
    nombre   = split_part(trim(nombre), ' ', 1)
WHERE apellido IS NULL;
