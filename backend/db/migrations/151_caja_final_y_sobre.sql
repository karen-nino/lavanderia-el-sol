-- Migración 151: el efectivo contado se reparte en CAJA FINAL y SOBRE
-- Fecha: 2026-10-09
--
-- Al cerrar su turno, el empleado cuenta el cajón y lo separa en dos:
--   · `monto_caja_final`: lo que se queda en el cajón. Es el fondo con el que
--     abre el siguiente turno (ver `aperturaSugerida`);
--   · `monto_sobre`: lo que se aparta en el sobre y sale del cajón.
-- Los dos suman lo contado (`monto_contado`), y eso lo valida el cierre.
--
-- NULL en los cortes de antes y en los cierres automáticos (nadie contó): ahí
-- el siguiente turno sigue abriendo con lo contado o con lo esperado, como
-- hasta ahora.

BEGIN;

ALTER TABLE cajas
  ADD COLUMN IF NOT EXISTS monto_caja_final NUMERIC(10,2) CHECK (monto_caja_final >= 0),
  ADD COLUMN IF NOT EXISTS monto_sobre      NUMERIC(10,2) CHECK (monto_sobre >= 0);

COMMIT;
