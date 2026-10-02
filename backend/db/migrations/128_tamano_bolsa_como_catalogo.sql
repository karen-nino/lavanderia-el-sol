-- Migración 128: la bolsa guarda su tamaño tal como está en el catálogo
-- ============================================================
-- Hasta ahora el producto guardaba el tamaño en minúsculas ('spe') y la app le
-- ponía mayúscula solo a la primera letra ('Spe'), así que un nombre escrito en
-- Ajustes como 'SPE' nunca se veía así. Desde aquí se guarda el nombre del
-- catálogo tal cual; esto alinea las bolsas que ya existían.

UPDATE productos p
   SET tamano_bolsa = t.nombre, updated_at = NOW()
  FROM tamanos_bolsa t
 WHERE p.clase = 'bolsa'
   AND lower(p.tamano_bolsa) = lower(t.nombre)
   AND p.tamano_bolsa <> t.nombre;
