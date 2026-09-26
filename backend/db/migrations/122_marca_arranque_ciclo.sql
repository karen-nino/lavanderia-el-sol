-- Migración 122: la marca dice si la máquina arranca sola y si corre un solo ciclo
-- Fecha: 2026-09-25
--
-- Las Speed Queen de esta lavandería **arrancan al recibir corriente**: no hay
-- que meter la ropa, elegir programa y apretar un botón como en las LG o las
-- Samsung. Para ellas el flujo de dos pasos de la mig. 110 —"Encender máquina"
-- y luego "Iniciar"— sobra: encender ES iniciar, y el segundo paso solo sirve
-- para que el cronómetro empiece tarde.
--
-- Y corren **un solo ciclo**: su programa completo basta para una carga, así
-- que ofrecerles la segunda vuelta de la mig. 108 sería regalar agua y luz.
--
-- Las dos cosas van en la MARCA y no clavadas en el código, que es donde el
-- negocio puede cambiarlas (Ajustes → Máquinas → Marcas y modelos). Se marcan
-- aparte porque son reglas distintas: puede aparecer una máquina que arranque
-- sola y sí repita ciclo. Van en la marca —y no en el modelo, donde viven los
-- tiempos— porque las ocho máquinas reales tienen marca y ninguna tiene modelo
-- capturado todavía: ahí es donde la regla aplica desde hoy.

BEGIN;

ALTER TABLE marcas_maquina
  ADD COLUMN IF NOT EXISTS arranca_sola BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ciclo_unico  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN marcas_maquina.arranca_sola IS
  'La máquina empieza su ciclo al recibir corriente: Salidas ofrece "Iniciar" en un solo paso.';
COMMENT ON COLUMN marcas_maquina.ciclo_unico IS
  'Una carga corre un solo ciclo en esta marca: no se ofrece la segunda vuelta.';

-- Speed Queen es la marca que hoy cumple las dos cosas en esta lavandería.
UPDATE marcas_maquina
   SET arranca_sola = TRUE, ciclo_unico = TRUE
 WHERE lower(nombre) = 'speed queen';

COMMIT;
