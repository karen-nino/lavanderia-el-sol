-- Migración 120: un modelo puede tener TRES tiempos y preguntar cuál usar
-- Fecha: 2026-09-23
--
-- Pedido del negocio para las secadoras: la Speed Queen Sec49 no tiene "un"
-- ciclo, tiene tres programas de distinta duración, y quién decide cuál corre
-- es el empleado con la ropa delante — no la configuración.
--
-- El modelo pasa a tener hasta tres tiempos (el primero es el `minutos` de la
-- mig. 117, que se queda donde estaba) y un interruptor:
--
--   · `pregunta_tiempo = TRUE`  → al iniciar esa máquina, la app pregunta con
--     cuál de los tres correr y sella el elegido.
--   · `pregunta_tiempo = FALSE` → no pregunta y manda **el último con valor**,
--     que es el más largo: quedarse corto le corta la corriente a media carga,
--     y pasarse solo cuesta unos minutos de reloj.
--
-- Nace apagado y con los otros dos tiempos vacíos, así que el día que se aplica
-- ningún modelo cambia de comportamiento: con un solo tiempo, "el último con
-- valor" es ese mismo.

BEGIN;

ALTER TABLE modelos_maquina
  ADD COLUMN IF NOT EXISTS minutos_2       INTEGER CHECK (minutos_2 > 0),
  ADD COLUMN IF NOT EXISTS minutos_3       INTEGER CHECK (minutos_3 > 0),
  ADD COLUMN IF NOT EXISTS pregunta_tiempo BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
