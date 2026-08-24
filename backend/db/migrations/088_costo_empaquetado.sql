-- Migración 088: costo de empaquetado en las cargas de Por Encargo
-- ============================================================
-- Costo configurable (Ajustes → cargas y precios) que se incluye por defecto en
-- cada carga de Por Encargo, dentro del tope (como las bolsas). Se puede quitar
-- por carga. Se guarda el monto aplicado por carga (0 = sin empaquetado).

ALTER TABLE ajustes      ADD COLUMN IF NOT EXISTS costo_empaquetado NUMERIC(10,2) DEFAULT 0;
ALTER TABLE nota_cargas  ADD COLUMN IF NOT EXISTS empaquetado       NUMERIC(10,2) NOT NULL DEFAULT 0;
