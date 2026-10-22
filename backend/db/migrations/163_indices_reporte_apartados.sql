-- Migración 163: índices para el Reporte diario de Inventario con apartados
-- Fecha: 2026-10-21
--
-- Desde v1.112.0 el reporte cuenta lo apartado en notas como salida. Para
-- saber cuándo se descontó cada renglón busca la primera 'venta' de su nota y
-- producto, y repasa los renglones de cada producto por fecha. Sin estos
-- índices esas búsquedas recorren el historial completo y se alentan con los
-- meses. Solo agrega índices: no cambia datos.

BEGIN;

-- La venta de una nota y producto, directo.
CREATE INDEX IF NOT EXISTS idx_prod_mov_venta_nota
  ON producto_movimientos (nota_id, producto_id, created_at)
  WHERE tipo = 'venta';

-- Los productos puestos en notas, por producto y fecha.
CREATE INDEX IF NOT EXISTS idx_nota_productos_producto
  ON nota_productos (producto_id, created_at);

COMMIT;
