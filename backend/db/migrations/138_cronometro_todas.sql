-- Migración 138: TODAS las máquinas corren con cronómetro; se va el tope aparte
-- Fecha: 2026-10-02
--
-- La 137 puso a las lavadoras LG y Samsung a contar hacia ARRIBA, con un tope
-- único en Ajustes (`tope_cronometro_minutos`) para cortarles la luz si nadie
-- las finalizaba. El mismo día el negocio lo extendió a todas las máquinas,
-- lavadoras y secadoras (menos el modelo que pregunta su tiempo, la Sec49).
--
-- Con eso el tope ya no es uno solo: es el de cada máquina. Los minutos que
-- antes eran su duración —los de su modelo, su marca o su tamaño— pasan a ser
-- su "Tope de carga", y el corte por fin de ciclo de siempre es el que apaga.
-- El tope aparte sobra y se quita. Volver al temporizador no lo necesita: es
-- `MAQUINAS_CRONOMETRO=off` en el servidor.

ALTER TABLE ajustes DROP CONSTRAINT IF EXISTS ajustes_tope_cronometro_positivo;
ALTER TABLE ajustes DROP COLUMN IF EXISTS tope_cronometro_minutos;
