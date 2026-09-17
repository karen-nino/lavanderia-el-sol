-- Migración 110: encender la máquina ANTES de arrancar su ciclo
-- Fecha: 2026-09-17
--
-- Hasta ahora "Iniciar Lavado" hacía dos cosas a la vez: cerrar el relé y
-- arrancar el cronómetro. Pero la lavadora no arranca sola al recibir
-- corriente —hay que apretar su botón físico— y entre una cosa y otra el
-- empleado todavía tiene que meter la ropa. Todo ese rato se le descontaba al
-- ciclo: con el corte por fin de ciclo activo (mig. 108) y un margen de 10 s,
-- la corriente se iba antes de que el lavado terminara, y las LG no reanudan.
--
-- Se parte en dos pasos: "Encender máquina" da corriente, y "Iniciar Lavado"
-- arranca el cronómetro cuando el lavado empezó de verdad.
--
-- El estado intermedio necesita nombre propio. Sin él, una máquina con
-- corriente y sin nota corriendo es exactamente lo que el reconciliador adopta
-- como "encendida a mano" (mig. 104), y entonces `activar-pendientes` —que
-- exige la máquina 'disponible'— rechazaba el segundo paso con un "ya está en
-- uso". Las dos columnas dicen lo que a la 104 le faltaba: no es que la
-- prendió cualquiera, la prendió ESTA nota y está esperando su arranque.
--
-- La máquina pasa a 'en_uso' (queda apartada, no se ofrece a otra nota) pero
-- `en_uso_desde` se queda en NULL a propósito: es lo que distingue "encendida
-- esperando" de "lavando", y lo que evita que un `ciclo_minutos` viejo arme un
-- corte que no toca. Ambos se llenan en el segundo paso.
--
-- La espera CADUCA (5 min por defecto, SONOFF_ESPERA_ARRANQUE_MINUTOS): si
-- nadie inicia el lavado, la máquina se apaga y vuelve a quedar libre, para que
-- un descuido no deje una lavadora prendida y apartada toda la tarde.

ALTER TABLE maquinas
  ADD COLUMN IF NOT EXISTS encendida_sin_iniciar_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS encendida_para_nota_id   INTEGER REFERENCES notas(id) ON DELETE SET NULL;

-- Una máquina esperando arranque tiene las dos columnas o ninguna: media
-- marca es un estado que el reconciliador no sabría leer.
ALTER TABLE maquinas
  DROP CONSTRAINT IF EXISTS maquinas_espera_arranque_completa,
  ADD  CONSTRAINT maquinas_espera_arranque_completa
       CHECK ((encendida_sin_iniciar_at IS NULL) = (encendida_para_nota_id IS NULL));
