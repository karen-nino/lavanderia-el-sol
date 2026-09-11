-- Migración 106: marca de la máquina + catálogo editable de marcas
-- Fecha: 2026-09-11
--
-- Hasta ahora la máquina solo tenía "modelo", un texto libre que quedó vacío
-- en todas: nadie escribe lo mismo a mano dos veces igual, así que el dato
-- nunca sirvió para nada. Se separan los dos conceptos:
--
--   marca  → catálogo cerrado y elegible (LG, Samsung, Speed Queen). Es el
--            dato que se repite entre máquinas y sobre el que se puede razonar.
--   modelo → sigue siendo texto libre (ej. "FH4U2VHN2"): es único de cada
--            aparato y no tiene sentido catalogarlo.
--
-- La marca importa más de lo que parece: la duración real de un ciclo depende
-- de ella y no del tamaño de la carga (LG 45 min, Samsung 45, Speed Queen 35),
-- mientras que hoy el sistema cronometra por tamaño. Tenerla como dato
-- confiable es el primer paso para que los tiempos dejen de depender de que
-- marca y tamaño coincidan por casualidad.
--
-- maquinas.marca guarda el NOMBRE elegido y no un id, igual que
-- notas.tipo_tela (mig. 042): así una máquina conserva su marca aunque el
-- catálogo se renombre o se reordene después.

BEGIN;

CREATE TABLE IF NOT EXISTS marcas_maquina (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Las marcas que hay hoy en la lavandería. Las Samsung todavía se están
-- instalando, pero se siembran desde ahora para que estén listas al darlas
-- de alta.
INSERT INTO marcas_maquina (nombre) VALUES
  ('LG'),
  ('Samsung'),
  ('Speed Queen')
ON CONFLICT (nombre) DO NOTHING;

-- Mismo criterio que la mig. 069: el orden inicial es el de creación.
UPDATE marcas_maquina SET orden = id WHERE orden IS NULL;

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS marca VARCHAR(60);

COMMIT;
