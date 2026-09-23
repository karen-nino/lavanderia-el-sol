-- Migración 117: catálogo de modelos colgando de cada marca
-- Fecha: 2026-09-23
--
-- La 106 dejó la marca como catálogo elegible y el modelo como texto libre,
-- con el argumento de que el modelo es único de cada aparato. En la práctica
-- no lo es: la lavandería compra de dos en dos y de tres en tres, así que las
-- tres LG son el mismo modelo. Texto libre significa que nadie lo escribe dos
-- veces igual, y por eso `maquinas.modelo` sigue vacío en las ocho máquinas
-- reales. Si el modelo se elige de una lista, se captura; si se escribe a
-- mano, no.
--
-- Un modelo guarda solo su NOMBRE y, opcionalmente, sus MINUTOS de ciclo. El
-- tipo, el tamaño y la capacidad se siguen capturando en cada máquina: dos
-- máquinas del mismo modelo pueden estar dadas de alta distinto y el catálogo
-- no tiene por qué opinar.
--
-- Los minutos son opcionales a propósito: el tiempo de ciclo pasa a resolverse
-- en cadena modelo → marca+tipo+tamaño (mig. 107) → tamaño (Ajustes). Esta
-- tabla nace vacía, así que el día que se aplica no cambia ningún tiempo; el
-- del modelo manda en cuanto alguien lo escriba.
--
-- `maquinas.modelo` sigue guardando el NOMBRE y no un id, igual que
-- `maquinas.marca` (mig. 106): la máquina conserva lo que decía aunque el
-- catálogo se renombre o se reordene después.

BEGIN;

CREATE TABLE IF NOT EXISTS modelos_maquina (
  id          SERIAL PRIMARY KEY,
  -- CASCADE como en `tiempos_marca`: borrar una marca se lleva lo que cuelga
  -- de ella. En la práctica las marcas no se borran, se desactivan.
  marca_id    INTEGER NOT NULL REFERENCES marcas_maquina(id) ON DELETE CASCADE,
  nombre      VARCHAR(60) NOT NULL,
  -- NULL = este modelo no tiene tiempo propio y cae al respaldo por marca.
  minutos     INTEGER CHECK (minutos > 0),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Dos marcas distintas sí pueden tener un modelo con el mismo nombre.
  UNIQUE (marca_id, nombre)
);

-- Se busca por marca en todas las pantallas (el desplegable de la máquina, la
-- sección de Ajustes) y por nombre al resolver el tiempo de una máquina.
CREATE INDEX IF NOT EXISTS idx_modelos_maquina_marca ON modelos_maquina (marca_id);

COMMIT;
