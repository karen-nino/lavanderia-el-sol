-- Migración 129: nuevo servicio Por Encargo "Mediano"
-- ============================================================
-- Entre Chico y Grande. Como ellos, va en lavadora y secadora medianas y su
-- precio es su tope (columna `tope_carga_mediano`, se captura en Ajustes).
-- La bolsa también puede ligarse a él para precargarse sola (mig. 125).

ALTER TABLE ajustes ADD COLUMN IF NOT EXISTS tope_carga_mediano NUMERIC(10,2);

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_servicios_bolsa_chk;
ALTER TABLE productos ADD CONSTRAINT productos_servicios_bolsa_chk
  CHECK (servicios_bolsa <@ ARRAY['chico', 'mediano', 'grande', 'edredon']::TEXT[]);
