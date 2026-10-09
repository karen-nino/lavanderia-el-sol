-- Migración 150: la sucursal 'lopez_cotilla' pasa a llamarse 'zapopan'
-- Fecha: 2026-10-09
--
-- El slug nació en la mig. 002 como 'lopez_cotilla' (la primera sucursal) y
-- después se le cambió el NOMBRE a "Zapopan", pero el slug se quedó. Ahora se
-- usa para configurar el servidor (DISPOSITIVOS_SUCURSALES) y tiene que decir
-- lo que es.
--
-- `sucursales.slug` es la llave que referencian las demás tablas, sin
-- ON UPDATE CASCADE, así que no se puede renombrar en el lugar: se crea la
-- fila nueva copiando la vieja, se mueven todas las referencias y se borra la
-- vieja. `producto_movimientos` guarda el slug sin llave foránea y se mueve
-- igual. Los DEFAULT de las columnas también apuntaban al slug viejo.
--
-- Las sesiones abiertas no se rompen: el usuario se relee de la base en cada
-- petición, y el header X-Sucursal viejo se traduce en `sucursalActiva`.

BEGIN;

INSERT INTO sucursales (slug, nombre, activa, created_at, direccion, telefono, orden, oculta)
SELECT 'zapopan', nombre, activa, created_at, direccion, telefono, orden, oculta
  FROM sucursales
 WHERE slug = 'lopez_cotilla'
ON CONFLICT (slug) DO NOTHING;

UPDATE usuarios             SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE clientes             SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE notas                SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE maquinas             SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE productos            SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE insumos              SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE cajas                SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE notificaciones       SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';
UPDATE producto_movimientos SET sucursal = 'zapopan' WHERE sucursal = 'lopez_cotilla';

DELETE FROM sucursales WHERE slug = 'lopez_cotilla';

ALTER TABLE usuarios  ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE clientes  ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE notas     ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE maquinas  ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE productos ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE insumos   ALTER COLUMN sucursal SET DEFAULT 'zapopan';
ALTER TABLE cajas     ALTER COLUMN sucursal SET DEFAULT 'zapopan';

COMMIT;
