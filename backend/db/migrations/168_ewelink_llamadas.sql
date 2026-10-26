-- Migración 168: contador de llamadas a la nube de eWeLink
-- Fecha: 2026-10-26
--
-- El plan gratuito de eWeLink da 50,000 llamadas al mes para toda la cuenta; al
-- pasarlas responde 412 "invoke too much" y los Sonoff dejan de obedecer (pasó el
-- 2026-10-24). eWeLink no tiene cómo consultar el uso, así que se cuenta aquí:
-- una fila por día (hora de México) y sucursal. Sucursal '' = llamadas de la
-- cuenta (renovar la sesión), que no son de ninguna sucursal.

BEGIN;

CREATE TABLE IF NOT EXISTS ewelink_llamadas (
  dia       DATE    NOT NULL,
  sucursal  TEXT    NOT NULL DEFAULT '',
  llamadas  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, sucursal)
);

COMMIT;
