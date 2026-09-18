-- Migración 113: nota al pie del ticket para la venta de Productos
-- Fecha: 2026-09-18
--
-- La 105 partió la nota al pie en dos —autoservicio y encargo— y la venta de
-- mostrador (mig. 112) nació usando la de autoservicio. En el papel no funciona:
-- ese texto habla de lavadora de alta eficiencia y minutos de secadora, y quien
-- solo vino a comprar un suavizante no lava nada.
--
--   ticket_nota_autoservicio → tickets de Autoservicio
--   ticket_nota_encargo      → tickets de Por Encargo y de Edredón
--   ticket_nota_productos    → tickets de venta de Productos   ← esta
--
-- Nace en NULL a propósito, sin copiar la de autoservicio: la venta llevaba su
-- texto justo porque no le quedaba. NULL = sin nota, y el ticket termina en el
-- "¡Gracias por su preferencia!" hasta que se capture desde Ajustes.

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS ticket_nota_productos TEXT;
