-- ============================================================
-- Migración 039: datos de contacto por sucursal
-- ============================================================
-- Cada sucursal tiene su propia dirección y teléfono, editables
-- desde Ajustes → "Información de sucursales". El nombre del
-- negocio (marca) y el logo siguen siendo globales (en ajustes).
-- ============================================================

ALTER TABLE sucursales
  ADD COLUMN direccion VARCHAR(200),
  ADD COLUMN telefono  VARCHAR(20);
