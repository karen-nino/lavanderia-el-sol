-- Migración 007: renombrar tabla articulos → productos

-- Renombrar tabla principal
ALTER TABLE articulos RENAME TO productos;

-- Renombrar columna en orden_articulos
ALTER TABLE orden_articulos RENAME COLUMN articulo_id TO producto_id;

-- Renombrar secuencia del ID si existe
ALTER SEQUENCE IF EXISTS articulos_id_seq RENAME TO productos_id_seq;
