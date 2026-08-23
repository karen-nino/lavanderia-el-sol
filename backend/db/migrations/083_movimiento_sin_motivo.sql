-- Migración 083: quita la columna "motivo" de los movimientos de producto
-- ============================================================
-- No se usa: el tipo de movimiento (entrada/salida/rellenar/…) y la descripción
-- ("15 botellas", "1 bidón") ya dan el contexto necesario.

ALTER TABLE producto_movimientos DROP COLUMN IF EXISTS motivo;
