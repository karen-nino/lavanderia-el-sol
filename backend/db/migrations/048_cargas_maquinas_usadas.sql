-- ============================================================
-- Migración 048: registro de máquinas usadas por carga
-- ============================================================
-- nota_cargas.lavadora_id / secadora_id apuntan a la máquina que la carga
-- OCUPA en este momento; se ponen en NULL cuando el ciclo termina (al iniciar
-- el secado se libera la lavadora; al terminar el secado se libera la
-- secadora), para que esa máquina quede libre para el siguiente cliente.
--
-- Eso hace que se pierda el rastro de qué máquinas usó la nota. Estas dos
-- columnas guardan ese registro histórico: se llenan al asignar una máquina
-- y NO se borran al liberarla, así el Detalle de la nota puede mostrar qué
-- lavadora y qué secadora se utilizaron.

ALTER TABLE nota_cargas
  ADD COLUMN IF NOT EXISTS lavadora_usada_id INTEGER REFERENCES maquinas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secadora_usada_id INTEGER REFERENCES maquinas(id) ON DELETE SET NULL;

-- Semilla: las cargas que ahora mismo tienen máquina asignada registran esa
-- misma máquina como usada.
UPDATE nota_cargas
   SET lavadora_usada_id = COALESCE(lavadora_usada_id, lavadora_id),
       secadora_usada_id = COALESCE(secadora_usada_id, secadora_id)
 WHERE lavadora_id IS NOT NULL OR secadora_id IS NOT NULL;
