-- Migración 131: el granel dice a qué servicios se precarga y cuántas medidas
-- ============================================================
-- Hasta ahora cada servicio Por Encargo traía puestas 2 medidas de jabón y 2 de
-- suavizante, y la app los encontraba por el NOMBRE del producto. Desde aquí
-- cada granel líquido declara, como la bolsa (mig. 125), a qué servicios va
-- ligado y cuántas medidas se le ponen solas a cada uno.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS servicios_precarga TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS medidas_precarga   INTEGER;

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_servicios_precarga_chk;
ALTER TABLE productos ADD CONSTRAINT productos_servicios_precarga_chk
  CHECK (servicios_precarga <@ ARRAY['chico', 'mediano', 'grande', 'edredon']::TEXT[]);

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_medidas_precarga_chk;
ALTER TABLE productos ADD CONSTRAINT productos_medidas_precarga_chk
  CHECK (medidas_precarga IS NULL OR medidas_precarga >= 1);

-- Los que hoy se precargan por nombre heredan lo de siempre: todos los
-- servicios, 2 medidas. Así nada cambia hasta que alguien lo edite.
UPDATE productos
   SET servicios_precarga = ARRAY['chico', 'mediano', 'grande', 'edredon'],
       medidas_precarga   = 2,
       updated_at         = NOW()
 WHERE tipo_liquido = 'granel'
   AND COALESCE(forma, 'liquido') = 'liquido'
   AND COALESCE(clase, 'liquido') <> 'bolsa'
   AND archivado = FALSE
   AND (nombre ~* 'jab[oó]n' OR nombre ~* 'suavizante');
