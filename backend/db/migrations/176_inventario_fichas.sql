-- Migración 176: inventario de fichas por sucursal
-- Fecha: 2026-11-10
--
-- Las máquinas "Trabaja con fichas: sin Sonoff y sin tiempos" (las Maytag de
-- Zapopan) arrancan con fichas del negocio, que luego se recogen de la máquina
-- y se vuelven a usar. A pedido de la usuaria:
-- - Ajustes → Operación → Fichas: cada sucursal usa fichas o no (usa_fichas).
-- - Inventario → Fichas: las que hay (fichas_disponibles), las que quedaron
--   dentro de cada máquina (maquinas.fichas_dentro) y "Recoger".
-- - Al iniciar una de esas máquinas se pregunta cuántas fichas (1, 2 o 3): salen
--   de las disponibles y entran a la máquina; la pasada las guarda.
-- Si no alcanzan se deja iniciar igual (mandan las fichas físicas) y el conteo
-- puede quedar negativo hasta corregirlo.
-- Arranque: Zapopan usa fichas y tiene 107; Retiro no.

BEGIN;

ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS usa_fichas         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fichas_disponibles INTEGER NOT NULL DEFAULT 0;

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS fichas_dentro INTEGER NOT NULL DEFAULT 0;

ALTER TABLE nota_carga_maquinas
  ADD COLUMN IF NOT EXISTS fichas INTEGER;

-- Historial: uso (al iniciar), recoger (de una máquina) y ajuste (corregir el conteo).
CREATE TABLE IF NOT EXISTS fichas_movimientos (
  id                  SERIAL PRIMARY KEY,
  sucursal            TEXT        NOT NULL,
  tipo                TEXT        NOT NULL CHECK (tipo IN ('uso', 'recoger', 'ajuste')),
  cantidad            INTEGER     NOT NULL,
  disponibles_despues INTEGER     NOT NULL,
  maquina_id          INTEGER     REFERENCES maquinas(id) ON DELETE SET NULL,
  maquina_nombre      TEXT,
  nota_id             INTEGER     REFERENCES notas(id) ON DELETE SET NULL,
  usuario_id          INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fichas_movimientos_sucursal_idx ON fichas_movimientos (sucursal, created_at DESC);

UPDATE sucursales SET usa_fichas = TRUE, fichas_disponibles = 107 WHERE slug = 'zapopan';

COMMIT;
