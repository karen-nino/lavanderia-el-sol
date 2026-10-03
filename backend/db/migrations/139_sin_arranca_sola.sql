-- Migración 139: se borra "Arranca sola al recibir corriente" de la marca
-- Fecha: 2026-10-02
--
-- La 122 puso en la marca de máquina `arranca_sola` para las Speed Queen, que
-- empiezan su ciclo al recibir corriente: con el temporizador eso les ahorraba
-- el paso de "Encender máquina" y Salidas ofrecía "Iniciar" de una vez.
--
-- Desde la 138 todas las máquinas corren con cronómetro y encender ES arrancar
-- en todas, así que la casilla ya no cambiaba nada (solo una frase del aviso).
-- El negocio pidió quitarla. Si algún día se vuelve al temporizador
-- (`MAQUINAS_CRONOMETRO=off`), las Speed Queen van en dos pasos como las demás.

ALTER TABLE marcas_maquina DROP COLUMN IF EXISTS arranca_sola;
