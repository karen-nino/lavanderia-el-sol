-- Migración 162: el aviso de granel (bidones) se apaga aparte del de stock
-- Fecha: 2026-10-16
--
-- `alerta_stock` (mig. 156) apagaba juntos dos avisos de la campana: el de
-- existencia (botellas, unidades, bolsas) y el de granel en bidones. A pedido
-- de la usuaria se separan:
--   · `alerta_stock`  → solo existencia (todo menos los bidones);
--   · `alerta_granel` → solo granel en bidones por acabarse o agotado.
-- El nuevo nace con lo que tenía `alerta_stock`: nada cambia hasta que
-- alguien mueva uno de los dos.

BEGIN;

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS alerta_granel BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE ajustes SET alerta_granel = alerta_stock;

COMMIT;
