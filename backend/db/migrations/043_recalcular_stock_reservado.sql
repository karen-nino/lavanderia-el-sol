-- ============================================================
-- Migración 043: recalcular stock_reservado desde las notas activas
-- ============================================================
-- La auditoría 2026-07-09 (hallazgo C2) encontró que cancelar o eliminar
-- una nota PAGADA restaba la reserva por segunda vez (stock_reservado
-- negativo), y que la transición LISTA → FINALIZADA nunca liberaba la
-- reserva (reservas huérfanas que inflan el stock comprometido).
--
-- El código ya quedó corregido; esta migración repara los datos que se
-- corrompieron mientras tanto. La reserva legítima de un producto es la
-- suma de sus cantidades en notas con estado activo (la reserva se libera
-- al cancelar y se consume al pagar o finalizar), así que se recalcula
-- desde esa fuente de verdad. Es idempotente.

UPDATE productos p
SET stock_reservado = COALESCE((
  SELECT SUM(np.cantidad)::int
  FROM nota_productos np
  JOIN notas n ON n.id = np.nota_id
  WHERE np.producto_id = p.id
    AND n.estado IN ('EN_ESPERA', 'EN_PROCESO', 'POR_PROCESAR', 'LISTA')
), 0)
WHERE p.stock_reservado <> COALESCE((
  SELECT SUM(np.cantidad)::int
  FROM nota_productos np
  JOIN notas n ON n.id = np.nota_id
  WHERE np.producto_id = p.id
    AND n.estado IN ('EN_ESPERA', 'EN_PROCESO', 'POR_PROCESAR', 'LISTA')
), 0);
