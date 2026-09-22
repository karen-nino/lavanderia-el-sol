-- Migración 114: historial de máquinas por carga
-- Fecha: 2026-09-22
--
-- `nota_cargas` guarda DOS referencias por hueco: la máquina que la carga ocupa
-- ahora (`lavadora_id` / `secadora_id`, que se ponen en NULL al terminar) y la
-- que usó (`lavadora_usada_id` / `secadora_usada_id`, mig. 048, que no se
-- borra). Eso alcanzaba mientras una carga pasara por una sola lavadora y una
-- sola secadora.
--
-- Desde el 2026-09-22 una carga puede repetir máquina —relavar, secar de más—,
-- y ahí el modelo se queda corto: la segunda pasada PISA la primera, así que la
-- nota deja de contar que también se lavó en L1. Y si las dos pasadas son en la
-- misma máquina, no hay manera de saber que fueron dos.
--
-- Esta tabla guarda UNA FILA POR PASADA, en orden. Los dos campos viejos se
-- quedan como están: los lee media app y siguen siendo "la última máquina de
-- ese hueco", que es lo que necesitan. Esto es el historial completo.
--
-- El nombre y el tipo se CONGELAN en la fila: `maquinas` se puede renombrar, y
-- borrar una máquina pone la referencia en NULL (igual que en nota_cargas), así
-- que sin la copia una nota vieja perdería en qué se lavó.

CREATE TABLE IF NOT EXISTS nota_carga_maquinas (
  id             SERIAL PRIMARY KEY,
  carga_id       INTEGER NOT NULL REFERENCES nota_cargas(id) ON DELETE CASCADE,
  slot           VARCHAR(10) NOT NULL CHECK (slot IN ('lavadora', 'secadora')),
  maquina_id     INTEGER REFERENCES maquinas(id) ON DELETE SET NULL,
  maquina_nombre VARCHAR(100) NOT NULL,
  maquina_tipo   VARCHAR(30),
  maquina_tamano VARCHAR(20),
  asignada_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Se lee siempre por carga y en orden de uso.
CREATE INDEX IF NOT EXISTS idx_carga_maquinas_carga
  ON nota_carga_maquinas (carga_id, asignada_at, id);

-- Semilla: lo que ya está registrado en los campos viejos pasa a ser la primera
-- pasada de su hueco. `created_at` de la carga es la fecha más honesta que hay
-- para una máquina que se asignó antes de que existiera esta tabla.
INSERT INTO nota_carga_maquinas (carga_id, slot, maquina_id, maquina_nombre, maquina_tipo, maquina_tamano, asignada_at)
SELECT nc.id, 'lavadora', m.id, m.nombre, m.tipo, m.tamano, COALESCE(nc.created_at, NOW())
  FROM nota_cargas nc
  JOIN maquinas m ON m.id = nc.lavadora_usada_id
 WHERE NOT EXISTS (
   SELECT 1 FROM nota_carga_maquinas x WHERE x.carga_id = nc.id AND x.slot = 'lavadora'
 );

INSERT INTO nota_carga_maquinas (carga_id, slot, maquina_id, maquina_nombre, maquina_tipo, maquina_tamano, asignada_at)
SELECT nc.id, 'secadora', m.id, m.nombre, m.tipo, m.tamano, COALESCE(nc.created_at, NOW())
  FROM nota_cargas nc
  JOIN maquinas m ON m.id = nc.secadora_usada_id
 WHERE NOT EXISTS (
   SELECT 1 FROM nota_carga_maquinas x WHERE x.carga_id = nc.id AND x.slot = 'secadora'
 );
