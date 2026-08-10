-- Check-in de empleados: el primer inicio de sesión del día cuenta como su
-- hora de entrada. El día se reinicia a medianoche local (America/Mexico_City),
-- por eso `fecha` se calcula en JS al hacer login y se guarda como DATE local.
-- `created_at` conserva el instante exacto del login (la hora que se muestra).
-- El UNIQUE (usuario_id, fecha) + ON CONFLICT DO NOTHING asegura que solo el
-- primer login del día queda registrado.
CREATE TABLE IF NOT EXISTS checkins (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_checkins_usuario_fecha ON checkins(usuario_id, fecha);
