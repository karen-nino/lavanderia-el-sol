-- Migración 155: cada sucursal lleva su propio folio
-- Fecha: 2026-10-10
--
-- El folio (`0041-101026`) usaba el `id` de la nota, que es una sola secuencia
-- para toda la base: Retiro saltaba del 0058 al 0063 porque Zapopan o Pruebas
-- hicieron notas en medio, y un hueco no decía nada. Ahora cada sucursal tiene
-- su contador (decisión de la usuaria: sin letra de sucursal), así que un
-- salto en el folio de una sucursal sí significa que falta una nota, y cada
-- sucursal puede empezar de nuevo sin tocar a las demás.
--
--   · `folios_sucursal.ultimo` es el último número usado. El alta lo sube en
--     la misma transacción que crea la nota (si el alta falla, no se gasta).
--   · Cada sucursal arranca en el número más alto de los folios que ya tiene,
--     para seguir donde iba sin repetir ninguno de los suyos.
--   · El folio ya no es único en toda la base, sino por sucursal: dos
--     sucursales pueden tener el mismo número.
-- Las notas que ya existen conservan su folio.

BEGIN;

CREATE TABLE IF NOT EXISTS folios_sucursal (
  sucursal VARCHAR(50) PRIMARY KEY REFERENCES sucursales(slug) ON DELETE CASCADE,
  ultimo   INTEGER NOT NULL DEFAULT 0 CHECK (ultimo >= 0)
);

INSERT INTO folios_sucursal (sucursal, ultimo)
SELECT s.slug,
       COALESCE((
         SELECT MAX(split_part(n.folio, '-', 1)::int)
           FROM notas n
          WHERE n.sucursal = s.slug AND split_part(n.folio, '-', 1) ~ '^[0-9]+$'
       ), 0)
  FROM sucursales s
ON CONFLICT (sucursal) DO NOTHING;

ALTER TABLE notas DROP CONSTRAINT IF EXISTS notaes_folio_key;
ALTER TABLE notas DROP CONSTRAINT IF EXISTS notas_folio_key;
ALTER TABLE notas ADD CONSTRAINT notas_sucursal_folio_key UNIQUE (sucursal, folio);

COMMIT;
