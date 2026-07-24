-- Marca de carga "adicional": distingue las cargas creadas al dar de alta la
-- nota (originales) de las que se agregaron después (p. ej. al asignar una
-- máquina extra desde Salidas). Sirve para separar en el ticket lo original de
-- lo adicional. Las cargas existentes y las de creación quedan como originales
-- (FALSE); solo las agregadas después se marcan TRUE.
ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS es_adicional BOOLEAN NOT NULL DEFAULT FALSE;
