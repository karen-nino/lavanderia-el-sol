-- Migración 107: el tiempo del ciclo se configura por MARCA y TAMAÑO
-- Fecha: 2026-09-11
--
-- Hasta ahora la duración salía solo del tamaño de la carga, y eso no cuadra
-- con la lavandería real: las lavadoras medianas son LG y tardan 45 min, y las
-- jumbo son Speed Queen y tardan 35. O sea que el eje estaba invertido — el
-- sistema daba por hecho que una jumbo tarda más que una mediana — y las tres
-- LG se cronometraban 15 minutos cortas. Un empleado que cerrara la carga
-- cuando el reloj llegaba a cero le cortaba la corriente a media lavada, y las
-- LG no reanudan solas.
--
-- La duración es de la MÁQUINA, no de la carga. Pero el tamaño sigue contando
-- (una LG mediana y una LG jumbo no tienen por qué tardar lo mismo), así que
-- la clave es marca + tipo + tamaño.
--
-- Los tiempos por tamaño de `ajustes` NO se borran: quedan de respaldo para
-- las máquinas sin marca o sin combinación configurada, de modo que nada
-- cambia de comportamiento el día que se aplica esto.

BEGIN;

CREATE TABLE IF NOT EXISTS tiempos_marca (
  id          SERIAL PRIMARY KEY,
  marca_id    INTEGER NOT NULL REFERENCES marcas_maquina(id) ON DELETE CASCADE,
  -- 'lavadora' | 'secadora'. Se guarda el tipo BASE, sin el tamaño pegado
  -- (maquinas.tipo es 'lavadora_mediana'/'lavadora_jumbo'/'secadora'), porque
  -- el tamaño ya viaja en su propia columna.
  tipo        VARCHAR(20) NOT NULL,
  tamano      VARCHAR(20) NOT NULL,
  minutos     INTEGER NOT NULL CHECK (minutos > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marca_id, tipo, tamano)
);

-- Los tiempos reales que dio el instalador el 2026-09-11: LG 45 min (L1, L2,
-- L3, medianas), Speed Queen 35 (L8, L9, jumbo) y Samsung 45 (dos en
-- instalación, entrarán como medianas). Las secadoras no se siembran: son 30
-- min para todas, que es justo lo que ya dice el respaldo por tamaño.
INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos)
SELECT id, 'lavadora', 'mediana', 45 FROM marcas_maquina WHERE nombre = 'LG'
UNION ALL
SELECT id, 'lavadora', 'mediana', 45 FROM marcas_maquina WHERE nombre = 'Samsung'
UNION ALL
SELECT id, 'lavadora', 'jumbo',   35 FROM marcas_maquina WHERE nombre = 'Speed Queen'
ON CONFLICT (marca_id, tipo, tamano) DO NOTHING;

-- El edredón deja de tener tiempo propio: usa el de jumbo, igual que cualquier
-- otra carga de esa máquina (decisión del negocio, 2026-09-11). Conserva su
-- PRECIO, que es lo que distingue el servicio; lo que se elimina es solo la
-- duración, que la marca la máquina y no la prenda.
ALTER TABLE ajustes
  DROP COLUMN IF EXISTS tiempo_edredon_jumbo,
  DROP COLUMN IF EXISTS tiempo_secadora_edredon;

COMMIT;
