-- ============================================================
-- Migración 103: por qué falló el Sonoff, guardado en la máquina
-- ============================================================
-- Hasta ahora la tarjeta solo decía "Sin conexión" cuando la última orden al
-- Sonoff falló. Eso no le sirve a nadie: no es lo mismo que falte conectar la
-- cuenta de eWeLink (se arregla en la app, en dos clics) a que el Sonoff esté
-- desconectado de la corriente (hay que ir a la máquina) o a que falten las
-- credenciales en el servidor (no se arregla desde la app).
--
-- El motivo técnico ya viajaba del driver a la respuesta del endpoint, pero se
-- perdía en cuanto se cerraba el aviso. Aquí se guarda ya traducido, para que
-- la tarjeta pueda explicarse sola sin tener que apretar "Probar".
--
-- NULL = no hay nada que explicar (el enlace está bien o nunca se ha probado).

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS sonoff_detalle TEXT;

COMMENT ON COLUMN maquinas.sonoff_detalle IS
  'Explicación en español del último fallo del Sonoff; NULL si la última orden salió bien.';

-- Además: 'error' se usaba para dos cosas muy distintas. Una máquina a la que
-- acaban de capturarle su Device ID quedaba en 'error' —o sea, en rojo y
-- diciendo "Sin conexión"— cuando en realidad nadie ha probado el enlace
-- todavía. Se separa en un estado propio, 'sin_probar', para no reportar una
-- falla que no existe.
ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_sonoff_estado_check;
ALTER TABLE maquinas
  ADD CONSTRAINT maquinas_sonoff_estado_check
  CHECK (sonoff_estado IN ('sin_enlazar', 'sin_probar', 'enlazada', 'error'));

-- Las que hoy están en 'error' sin haberse sincronizado nunca son justamente
-- ese caso: enlace capturado, nunca verificado.
UPDATE maquinas
   SET sonoff_estado = 'sin_probar'
 WHERE sonoff_estado = 'error' AND sonoff_sync_at IS NULL;
