-- ============================================================
-- Migración 044: columna secadora_id en notas
-- ============================================================
-- Autoservicio ahora permite asignar dos máquinas por nota: una
-- lavadora (maquina_id, la que ya existía) y una secadora
-- (secadora_id, nueva). Ambas son opcionales. El precio por carga se
-- calcula sumando la tarifa de la lavadora y la de la secadora.
--
-- ON DELETE SET NULL para no bloquear el borrado de una máquina que
-- fue usada como secadora en notas históricas.

ALTER TABLE notas
  ADD COLUMN IF NOT EXISTS secadora_id INTEGER REFERENCES maquinas(id) ON DELETE SET NULL;
