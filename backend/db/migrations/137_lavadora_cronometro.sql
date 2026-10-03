-- Migración 137: las lavadoras LG y Samsung corren con CRONÓMETRO
-- Fecha: 2026-10-02
--
-- Hasta ahora toda lavadora llevaba un temporizador: "Encender máquina" le daba
-- corriente, "Iniciar Lavado" arrancaba la cuenta atrás con los minutos de su
-- marca o modelo, al llegar a cero el corte le quitaba la luz y la carga podía
-- pedir un segundo ciclo (migs. 108 y 110).
--
-- El negocio lo cambia para las LG y las Samsung: al ENCENDER empieza un
-- cronómetro que cuenta hacia arriba, el empleado arranca la lavadora con su
-- botón cuando quiera, y la carga termina cuando alguien la finaliza desde la
-- tarjeta. Un solo ciclo, sin paso de "Iniciar" ni segunda vuelta.
--
-- Qué marcas van así lo decide el código (MARCAS_CRONOMETRO en db/sqlMaquina.js)
-- mientras el negocio lo prueba: es temporal y a propósito no se puede tocar
-- desde Ajustes.
--
-- Lo que sí va aquí es el TOPE. Sin temporizador nada apagaba una lavadora
-- olvidada, y con corriente su botón funciona: se podría lavar otra carga sin
-- nota. Pasado este tope desde que se encendió, el corte le quita la luz y se
-- avisa en la campana. La nota no se toca: sigue en Lavando hasta que alguien
-- la finalice.

ALTER TABLE ajustes
  ADD COLUMN IF NOT EXISTS tope_cronometro_minutos INTEGER NOT NULL DEFAULT 60;

ALTER TABLE ajustes
  DROP CONSTRAINT IF EXISTS ajustes_tope_cronometro_positivo,
  ADD  CONSTRAINT ajustes_tope_cronometro_positivo CHECK (tope_cronometro_minutos >= 1);
