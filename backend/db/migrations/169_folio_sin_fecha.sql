-- Migración 169: el folio de la nota pierde la fecha ("0130-261026" → "0130")
-- Fecha: 2026-10-26
--
-- A pedido de la usuaria: con el folio por sucursal (mig. 155) la fecha ya no
-- hace falta para distinguir notas. Las nuevas nacen sin ella (generarFolio) y
-- aquí se le quita a las que ya existen. Si dos notas de la misma sucursal
-- quedarían con el mismo número (algún reinicio de folio), esas conservan la
-- fecha: la llave única es (sucursal, folio).

BEGIN;

UPDATE notas n
   SET folio = split_part(n.folio, '-', 1)
 WHERE n.folio LIKE '%-%'
   AND NOT EXISTS (
     SELECT 1 FROM notas o
      WHERE o.sucursal = n.sucursal
        AND o.id <> n.id
        AND split_part(o.folio, '-', 1) = split_part(n.folio, '-', 1)
   );

COMMIT;
