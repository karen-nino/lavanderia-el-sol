-- Migración 161: cada renglón de producto de una nota sabe si ya se descontó
-- Fecha: 2026-10-11
--
-- Hasta aquí el inventario de una nota se movía de una sola vez: al crearla se
-- apartaba todo (stock_reservado) y al cobrarla o entregarla se descontaba
-- todo (stock_actual); "ya se descontó" se sabía por nota, mirando si había
-- un movimiento 'venta'. Ahora el GRANEL de los servicios se descuenta antes,
-- al terminar la primera lavadora de la nota (a pedido de la usuaria): deja de
-- salir como "apartado" en Inventario en cuanto se usó. Eso obliga a llevar la
-- cuenta por renglón.
--
-- `consumido_at` NULL = apartado; con fecha = ya salió del estante.
--
-- Relleno: se marcan como descontados los renglones de las notas que ya
-- vendieron (tienen movimiento 'venta', o están PAGADA/FINALIZADA, por si son
-- de antes del historial). Las CANCELADAS no: al cancelar ya se devolvió todo.

BEGIN;

ALTER TABLE nota_productos ADD COLUMN IF NOT EXISTS consumido_at TIMESTAMPTZ;

UPDATE nota_productos np
   SET consumido_at = NOW()
  FROM notas n
 WHERE n.id = np.nota_id
   AND np.consumido_at IS NULL
   AND n.estado <> 'CANCELADA'
   AND (n.estado IN ('PAGADA', 'FINALIZADA')
        OR EXISTS (SELECT 1 FROM producto_movimientos pm
                    WHERE pm.nota_id = n.id AND pm.tipo = 'venta'));

COMMIT;
