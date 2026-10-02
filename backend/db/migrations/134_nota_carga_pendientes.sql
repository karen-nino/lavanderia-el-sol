-- Migración 134: granel por elegir de cada servicio Por Encargo
-- ============================================================
-- Al crear la nota, cada servicio sabe CUÁNTO lleva de cada tipo de granel
-- (Ajustes → Servicios Por Encargo, mig. 132) pero no CUÁL producto: eso lo
-- elige el empleado en Salidas. Cada renglón de aquí es "Chico 1: 1 medida de
-- Jabón, sin elegir". Al elegirlo se vuelve un producto de la carga
-- (nota_productos, que aparta existencias) y el renglón se borra.
--
-- Si el tipo tiene un solo producto ligado al servicio y alcanza, no hay nada
-- que elegir: entra directo como producto y aquí no queda nada.

CREATE TABLE IF NOT EXISTS nota_carga_pendientes (
  id             SERIAL PRIMARY KEY,
  nota_id        INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  carga_id       INTEGER NOT NULL REFERENCES nota_cargas(id) ON DELETE CASCADE,
  tipo_granel_id INTEGER NOT NULL REFERENCES tipos_granel(id),
  cantidad       INTEGER NOT NULL CHECK (cantidad >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carga_id, tipo_granel_id)
);

CREATE INDEX IF NOT EXISTS idx_nota_carga_pendientes_nota ON nota_carga_pendientes(nota_id);
