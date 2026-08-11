-- Categoría de producto (Detergente, Suavizante, Blanqueador, Bolsas, Otro).
-- El formulario de Inventario ya la capturaba, pero el backend no la guardaba
-- ni existía la columna; con esto queda persistida y disponible para reportes
-- (p. ej. el detalle de productos en el desempeño del empleado).
ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria VARCHAR(50);
