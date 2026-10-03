-- Migración 144: el movimiento de inventario guarda el FOLIO de su nota
-- Fecha: 2026-10-03
--
-- Las ventas y devoluciones de producto apuntan a su nota por `nota_id`, que
-- se pone en NULL si la nota se borra (ON DELETE SET NULL). Borrar una nota
-- pagada es justo lo que devuelve el producto al estante, así que la columna
-- Devuelto del Reporte diario se quedaba sin poder decir qué nota se anuló.
-- Se copia el folio al registrar el movimiento, como ya se hace con el nombre
-- de la máquina en el historial de pasadas (mig. 114).
--
-- Relleno de lo que ya existe:
--   · con la nota viva, su folio;
--   · las devoluciones por notas BORRADAS: el borrado avisa en la campana
--     ('nota_eliminada', con el folio) en la misma transacción, así que el
--     aviso y la devolución comparten el instante exacto y la sucursal.
-- Las ventas de notas ya borradas no tienen de dónde sacarlo y quedan en NULL.

ALTER TABLE producto_movimientos
  ADD COLUMN IF NOT EXISTS nota_folio VARCHAR(30);

UPDATE producto_movimientos m
   SET nota_folio = n.folio
  FROM notas n
 WHERE n.id = m.nota_id
   AND m.nota_folio IS NULL;

UPDATE producto_movimientos m
   SET nota_folio = x.nota_folio
  FROM notificaciones x
 WHERE m.tipo = 'liberacion'
   AND m.nota_id IS NULL
   AND m.nota_folio IS NULL
   AND x.tipo = 'nota_eliminada'
   AND x.nota_folio IS NOT NULL
   AND x.created_at = m.created_at
   AND x.sucursal = m.sucursal;
