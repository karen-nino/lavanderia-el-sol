-- Migración 109: en_uso_desde pasa a TIMESTAMPTZ
-- Fecha: 2026-09-17
--
-- `maquinas.en_uso_desde` se creó como TIMESTAMP SIN zona (mig. 023), mientras
-- que su vecina `encendida_manual_at` (mig. 104) sí la lleva. La diferencia no
-- se notaba porque el backend y Supabase corren los dos en UTC: el valor
-- ingenuo que devuelve la base se interpreta en Node como hora local, y siendo
-- ambas UTC coincide por casualidad.
--
-- Deja de coincidir en cuanto el proceso corre en otra zona —una laptop en
-- America/Mexico_City, por ejemplo— y ahí `new Date(en_uso_desde)` se va 6
-- horas: el temporizador de la tarjeta miente y el corte por fin de ciclo cree
-- que la máquina arrancó en el futuro, así que no corta nunca.
--
-- Hasta ahora eso era una fragilidad tolerable, porque el margen de corte era
-- de 20 minutos y el error tenía que ser enorme para importar. Con el margen en
-- segundos (mig. 108) el cálculo es fino y no puede depender de que dos relojes
-- estén configurados igual.
--
-- La conversión asume UTC porque es lo que se escribió: todos los valores los
-- puso NOW() con la sesión de Postgres en UTC.

ALTER TABLE maquinas
  ALTER COLUMN en_uso_desde TYPE TIMESTAMPTZ
  USING en_uso_desde AT TIME ZONE 'UTC';
