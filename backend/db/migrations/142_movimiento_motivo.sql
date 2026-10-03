-- Migración 142: por qué salió el producto en una salida manual
-- Fecha: 2026-10-03
--
-- Inventario → Salidas descontaba existencia sin decir por qué: en el Reporte
-- diario una salida manual solo se podía leer como "Salida manual", y una
-- merma no se distinguía de un regalo o de lo que se usó en el local. Ahora la
-- salida pide su motivo (Merma, Dañado, Uso interno, Regalo u Otro con texto)
-- y se guarda aquí, en el movimiento.
--
-- Las salidas anteriores y los demás movimientos (entradas, ventas,
-- rellenar…) quedan en NULL: no tienen motivo que capturar.

ALTER TABLE producto_movimientos
  ADD COLUMN IF NOT EXISTS motivo VARCHAR(100);
