-- Migración 164: costo de cada ficha de la secadora de fichas (Sec49)
-- Fecha: 2026-10-21
--
-- Desde v1.114.0 "Otra ficha" le suma los minutos de una ficha a la secadora
-- de fichas mientras corre. A pedido de la usuaria cada ficha tiene un COSTO,
-- del modelo (Ajustes → Máquinas, junto a "Cada ficha"), que se le cobra a la
-- nota en Autoservicio; en Por Encargo el secado ya va en el servicio y la
-- ficha solo se cuenta.
--   · modelos_maquina.precio_por_ficha: el costo; NULL = sin costo.
--   · nota_cargas.fichas_extra: cuántas fichas de más llevó la carga.
--   · nota_cargas.precio_fichas_extra: lo que suman (congelado al meterlas:
--     cambiar Ajustes no re-tarifa notas).

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS precio_por_ficha NUMERIC(10, 2);

ALTER TABLE nota_cargas ADD COLUMN IF NOT EXISTS fichas_extra INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nota_cargas ADD COLUMN IF NOT EXISTS precio_fichas_extra NUMERIC(10, 2) NOT NULL DEFAULT 0;

COMMIT;
