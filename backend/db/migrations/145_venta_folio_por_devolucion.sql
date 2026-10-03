-- Migración 145: recuperar el folio de las ventas de notas ya borradas
-- Fecha: 2026-10-03
--
-- Desde el 2026-10-03 una venta que después se devolvió deja de contar en
-- Salidas del Reporte diario: solo aparece en Devuelto. Para eso la venta y su
-- devolución se empatan por la nota (folio, mig. 144). Las ventas de notas que
-- se borraron antes de la 144 perdieron `nota_id` y no tenían folio.
--
-- Se recuperan así: todos los productos de una nota se registran en la misma
-- transacción, así que sus ventas comparten instante y sucursal, igual que sus
-- devoluciones. Para cada devolución con folio se toma el grupo de ventas sin
-- nota MÁS RECIENTE anterior a ella, de la misma sucursal y con exactamente los
-- mismos productos, y se le pone ese folio. Si no hay uno así, se deja como
-- estaba: mejor sin folio que con uno equivocado.

DO $$
DECLARE
  dev RECORD;
  t_venta TIMESTAMPTZ;
BEGIN
  FOR dev IN
    SELECT sucursal, created_at, nota_folio,
           array_agg(producto_id ORDER BY producto_id) AS productos
      FROM producto_movimientos
     WHERE tipo = 'liberacion' AND nota_folio IS NOT NULL
     GROUP BY sucursal, created_at, nota_folio
     ORDER BY created_at
  LOOP
    -- Ya hay una venta con ese folio: no hay nada que recuperar.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM producto_movimientos
       WHERE tipo = 'venta' AND sucursal = dev.sucursal AND nota_folio = dev.nota_folio
    );

    SELECT v.created_at INTO t_venta
      FROM (
        SELECT created_at, array_agg(producto_id ORDER BY producto_id) AS productos
          FROM producto_movimientos
         WHERE tipo = 'venta' AND nota_id IS NULL AND nota_folio IS NULL
           AND sucursal = dev.sucursal AND created_at < dev.created_at
         GROUP BY created_at
      ) v
     WHERE v.productos = dev.productos
     ORDER BY v.created_at DESC
     LIMIT 1;

    IF t_venta IS NOT NULL THEN
      UPDATE producto_movimientos
         SET nota_folio = dev.nota_folio
       WHERE tipo = 'venta' AND nota_id IS NULL AND nota_folio IS NULL
         AND sucursal = dev.sucursal AND created_at = t_venta;
    END IF;
  END LOOP;
END $$;
