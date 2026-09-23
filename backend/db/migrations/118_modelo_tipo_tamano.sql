-- Migración 118: el modelo dice qué máquina es (tipo y tamaño)
-- Fecha: 2026-09-23
--
-- La 117 le puso al modelo un tiempo de ciclo propio, capturado en el propio
-- catálogo. Al verlo funcionando, el negocio lo pidió al revés y tiene razón:
-- el tiempo se configura donde ya se configuran todos los tiempos —los bloques
-- de Lavadora y Secadora de Ajustes— y el catálogo solo dice qué es cada
-- modelo. Ahí el renglón deja de ser "LG" y pasa a ser "LG · WM22WV26SR".
--
-- Para eso el modelo tiene que saber a qué bloque pertenece, que es tipo
-- (lavadora/secadora) y tamaño (mediana/jumbo). Los mismos dos ejes que ya
-- usaban `tiempos_marca` (mig. 107) y la máquina.
--
-- `minutos` NO se va: sigue siendo donde vive el tiempo del modelo y el primer
-- escalón de la cadena modelo → marca+tamaño → tamaño (Ajustes). Lo que cambia
-- es desde qué pantalla se escribe.

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS tipo   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tamano VARCHAR(20);

-- Lo que ya existiera se da por lavadora mediana, que es el caso común y el
-- que traen por defecto los formularios. Hoy la tabla está vacía en
-- producción: la 117 la creó y todavía no se ha capturado ningún modelo.
UPDATE modelos_maquina SET tipo   = 'lavadora' WHERE tipo   IS NULL;
UPDATE modelos_maquina SET tamano = 'mediana'  WHERE tamano IS NULL;

ALTER TABLE modelos_maquina
  ALTER COLUMN tipo   SET NOT NULL,
  ALTER COLUMN tamano SET NOT NULL;

-- Los dos ejes son cerrados, igual que en `tiempos_marca`. La migración corre
-- dentro de una transacción, así que el guard es por si se re-aplica a mano.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modelos_maquina_tipo_chk') THEN
    ALTER TABLE modelos_maquina
      ADD CONSTRAINT modelos_maquina_tipo_chk CHECK (tipo IN ('lavadora', 'secadora'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modelos_maquina_tamano_chk') THEN
    ALTER TABLE modelos_maquina
      ADD CONSTRAINT modelos_maquina_tamano_chk CHECK (tamano IN ('mediana', 'jumbo'));
  END IF;
END $$;

COMMIT;
