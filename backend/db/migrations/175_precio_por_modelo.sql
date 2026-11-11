-- Migración 175: precio por carga propio del modelo de máquina
-- Fecha: 2026-11-10
--
-- Hasta hoy el precio salía solo del tamaño (Ajustes → Máquinas). A pedido de
-- la usuaria, un modelo puede cobrar distinto que los demás de su tamaño: el
-- Maytag2 (secadora mediana de Zapopan) cobra $55. NULL = usa el del tamaño.
-- Se captura en el renglón del modelo, debajo del precio del tamaño; también en
-- los modelos que trabajan con fichas (sin tope).

BEGIN;

ALTER TABLE modelos_maquina ADD COLUMN IF NOT EXISTS precio_carga NUMERIC(10,2);

UPDATE modelos_maquina mo
   SET precio_carga = 55.00
  FROM marcas_maquina mm
 WHERE mm.id = mo.marca_id
   AND LOWER(TRIM(mm.nombre)) = 'maytag'
   AND LOWER(TRIM(mo.nombre)) = 'maytag2'
   AND mo.tipo = 'secadora';

COMMIT;
