-- Migración 180: borrar ajustes.stock_minimo_global
-- Fecha: 2026-11-20
--
-- El mínimo general de stock (mig. 008) dejó de usarse en v1.35.2: cada
-- producto lleva su propio productos.stock_minimo. Se quitó de la pantalla y
-- del código; aquí se borra la columna a pedido de la usuaria.

ALTER TABLE ajustes DROP COLUMN IF EXISTS stock_minimo_global;
