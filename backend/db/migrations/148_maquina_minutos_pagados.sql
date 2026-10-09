-- Migración 148: minutos METIDOS en monedas, aparte de cuándo se acaba el tiempo
-- Fecha: 2026-10-08
--
-- "Otro ciclo" de la secadora de monedas que pregunta (Sec49): al terminar su
-- programa, el empleado le puede sumar otro sin pasarse del tope (30 min en la
-- S4). Puede tardar en decidirse: elige 10, se acaban al minuto 10 y le suma
-- 20 al minuto 15. La secadora seca entonces hasta el minuto 35, no hasta el 30.
--
-- Por eso son dos números distintos:
--   · `ciclo_elegido_minutos` sigue siendo CUÁNDO se le acaba el tiempo,
--     contado desde `en_uso_desde` (35 en el ejemplo): manda el aviso y el
--     "Terminó su programa".
--   · `minutos_pagados` es lo que se le ha metido en monedas en este arranque
--     (10 + 20 = 30): es lo que se compara con el tope. NULL = no se le ha
--     sumado nada y vale lo mismo que `ciclo_elegido_minutos`.

BEGIN;

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS minutos_pagados INTEGER CHECK (minutos_pagados > 0);

COMMIT;
