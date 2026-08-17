-- Migración 071: renombrar "categoría" de producto a "marca".
-- ============================================================
-- El concepto de agrupación de productos en Inventario pasa a llamarse "marca"
-- (antes "categoría"). El sistema aún no está en uso, así que no hay datos que
-- migrar: es un rename directo de la columna y de la tabla de catálogo.
--   • productos.categoria      → productos.marca
--   • tabla categorias_producto → marcas_producto
-- La categoría de secado (notas) y la categoría de insumos son conceptos
-- distintos y NO se tocan.

ALTER TABLE productos RENAME COLUMN categoria TO marca;
ALTER TABLE categorias_producto RENAME TO marcas_producto;
