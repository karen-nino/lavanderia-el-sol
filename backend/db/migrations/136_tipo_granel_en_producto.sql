-- Migración 136: el tipo de granel se elige en el PRODUCTO
-- ============================================================
-- En la 133 el tipo (Jabón, Suavizante…) se asignaba en el catálogo de nombres
-- de Granel y el producto lo heredaba por su nombre. Se prefirió elegirlo en el
-- propio producto, al darlo de alta o editarlo en Inventario, debajo de si es
-- líquido o polvo. Solo el granel LÍQUIDO lleva tipo: el polvo se vende por
-- unidad (mig. 126).

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS tipo_granel_id INTEGER REFERENCES tipos_granel(id) ON DELETE SET NULL;

-- Lo que ya estaba asignado en el catálogo pasa a los productos de ese nombre.
UPDATE productos p
   SET tipo_granel_id = g.tipo_id, updated_at = NOW()
  FROM graneles_producto g
 WHERE lower(g.nombre) = lower(p.nombre)
   AND g.tipo_id IS NOT NULL
   AND p.tipo_liquido = 'granel'
   AND COALESCE(p.forma, 'liquido') = 'liquido'
   AND COALESCE(p.clase, 'liquido') <> 'bolsa';

ALTER TABLE graneles_producto DROP COLUMN IF EXISTS tipo_id;
