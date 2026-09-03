-- Migración 100: quitar el empaquetado
-- Fecha: 2026-09-03
--
-- El costo de "Empaquetado" (mig. 088) se agregaba por defecto a cada carga Por
-- Encargo y contaba dentro del tope. El negocio dejó de usarlo, así que se
-- retira de toda la aplicación en vez de dejarlo configurado en 0: un ajuste
-- que nadie usa termina encendido por accidente y descuadrando precios.
--
-- Se borran las dos columnas. Los totales ya cobrados NO cambian: `precio_total`
-- está guardado en cada nota, y en Por Encargo con tope el precio de la carga es
-- el tope congelado (mig. 096), no la suma de sus partes. Lo que se pierde es el
-- desglose histórico de cuánto de una carga vieja era empaquetado.

ALTER TABLE nota_cargas DROP COLUMN IF EXISTS empaquetado;
ALTER TABLE ajustes     DROP COLUMN IF EXISTS costo_empaquetado;
