-- Migración 077: orden manual de sucursales
-- Fecha: 2026-08-20
--
-- Las sucursales se listaban alfabéticamente (nombre ASC), lo que dejaba
-- "López Cotilla" antes que "Retiro". El negocio quiere un orden propio, así
-- que se agrega una columna `orden` (menor = primero) y se siembra el orden
-- deseado: Retiro primero, luego López Cotilla. Nuevas sucursales arrancan al
-- final (default 100) hasta que se les dé un orden.

ALTER TABLE sucursales
  ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 100;

UPDATE sucursales SET orden = 1 WHERE slug = 'retiro';
UPDATE sucursales SET orden = 2 WHERE slug = 'lopez_cotilla';
