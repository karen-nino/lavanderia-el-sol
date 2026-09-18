-- Migración 112: tipo de servicio PRODUCTOS (venta de mostrador)
-- Fecha: 2026-09-18
--
-- Tercer tipo de servicio: la venta de productos sueltos. El cliente llega,
-- compra un suavizante y dos bolsas, paga y se va — sin lavadora, sin secadora
-- y sin cargas.
--
-- No estrena tablas: la venta es una nota más, con sus productos colgando a
-- nivel nota (nota_productos con carga_id NULL, que es como ya se guardan los
-- productos de Autoservicio). Así hereda folio, ticket, caja, corte, historial
-- y el descuento de inventario sin duplicar nada.
--
-- Lo único que le faltaba a la base era el valor del enum. Se puede agregar
-- dentro de la transacción del runner porque esta migración no lo USA: en
-- Postgres 12+ solo está prohibido leer o escribir el valor nuevo en la misma
-- transacción que lo crea.

ALTER TYPE tipo_servicio ADD VALUE IF NOT EXISTS 'PRODUCTOS';
