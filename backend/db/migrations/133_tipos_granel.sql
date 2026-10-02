-- Migración 133: tipo de cada granel (Jabón, Suavizante…)
-- ============================================================
-- Un servicio Por Encargo lleva N medidas de CADA TIPO de granel (Ajustes →
-- Servicios Por Encargo), y cuál producto de ese tipo se usa lo elige el
-- empleado en Salidas. Para eso la app tiene que saber que OXXI MEJORADO y
-- PERSIL son jabón y que SE AZUL y SE BLANCO son suavizante.
--
-- Los tipos son un catálogo editable (Ajustes → Inventario). El tipo se asigna
-- en el catálogo de Granel —una vez por nombre— y el producto lo hereda por su
-- nombre, que sale de ese mismo catálogo (mig. 119). Solo cuenta para el
-- granel LÍQUIDO: el polvo se vende por unidad (mig. 126).

CREATE TABLE IF NOT EXISTS tipos_granel (
  id         SERIAL PRIMARY KEY,
  nombre     VARCHAR(60) NOT NULL UNIQUE,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  orden      INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tipos_granel (nombre, orden) VALUES ('Jabón', 1), ('Suavizante', 2)
ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE graneles_producto
  ADD COLUMN IF NOT EXISTS tipo_id INTEGER REFERENCES tipos_granel(id) ON DELETE SET NULL;

-- Los graneles que el negocio ya tiene, con el tipo que dijo la dueña
-- (2026-10-02). TRATA COLOR y TRATA BCO son polvo y no llevan tipo.
UPDATE graneles_producto g
   SET tipo_id = t.id, updated_at = NOW()
  FROM tipos_granel t
 WHERE g.tipo_id IS NULL
   AND (   (t.nombre = 'Jabón'      AND upper(g.nombre) IN ('OXXI MEJORADO', 'PERSIL'))
        OR (t.nombre = 'Suavizante' AND upper(g.nombre) IN ('SE AZUL', 'SE BLANCO')));
