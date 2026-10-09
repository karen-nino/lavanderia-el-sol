-- Migración 152: "moneda" pasa a llamarse "ficha"
-- Fecha: 2026-10-09
--
-- Las secadoras de la mig. 147 no reciben monedas: el negocio usa FICHAS, y
-- así se llaman ya en la pantalla. Se renombran las dos columnas para que el
-- código diga lo mismo:
--   · modelos_maquina.minutos_por_moneda → minutos_por_ficha
--     (cuántos minutos da cada ficha; vacío = no se le meten fichas);
--   · maquinas.monedas_para_uso → fichas_para_uso
--     (el arranque al que ya se le metieron sus fichas).
-- Solo cambia el nombre: los datos y el CHECK (> 0) se quedan como están.
--
-- Ojo: no confundir con `modelos_maquina.solo_fichas` (mig. 149), el modelo
-- que trabaja con fichas SIN Sonoff. Estas son las que el Sonoff alimenta.

BEGIN;

ALTER TABLE modelos_maquina RENAME COLUMN minutos_por_moneda TO minutos_por_ficha;
ALTER TABLE maquinas        RENAME COLUMN monedas_para_uso   TO fichas_para_uso;

COMMIT;
