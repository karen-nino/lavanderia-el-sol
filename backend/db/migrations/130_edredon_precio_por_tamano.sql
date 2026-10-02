-- Migración 130: el servicio Edredón se cobra según su tamaño
-- ============================================================
-- Antes había un solo servicio Edredón con un precio (`ajustes.tope_carga_edredon`)
-- y el tamaño era una etiqueta interna opcional. Ahora cada tamaño del catálogo
-- (Individual, Matrimonial, King, Cubre Colchón) es un servicio con su propio
-- precio, que se captura en Ajustes → Servicios Por Encargo.
--
-- El precio nace vacío: sin precio el tamaño no se puede vender, y la pantalla
-- lo dice. `tope_carga_edredon` se conserva para las cargas de edredón viejas
-- que no traen tamaño.

ALTER TABLE tamanos_edredon ADD COLUMN IF NOT EXISTS precio NUMERIC(10,2);

INSERT INTO tamanos_edredon (nombre, orden) VALUES
  ('Individual', 1), ('Matrimonial', 2), ('King', 3), ('Cubre Colchón', 4)
ON CONFLICT (nombre) DO NOTHING;

-- Los cuatro quedan activos y en ese orden; cualquier otro (Queen) se desactiva:
-- deja de ofrecerse, pero las notas que ya lo usan lo conservan.
UPDATE tamanos_edredon
   SET activo = (nombre IN ('Individual', 'Matrimonial', 'King', 'Cubre Colchón')),
       orden  = CASE nombre
                  WHEN 'Individual'    THEN 1
                  WHEN 'Matrimonial'   THEN 2
                  WHEN 'King'          THEN 3
                  WHEN 'Cubre Colchón' THEN 4
                  ELSE 100 + id
                END,
       updated_at = NOW();
