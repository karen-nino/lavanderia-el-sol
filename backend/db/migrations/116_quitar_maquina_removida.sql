-- Migración 116: quitar la marca de máquina "eliminada"
-- Fecha: 2026-09-22
--
-- La mig. 056 abrió `lavadora_removida` / `secadora_removida` para distinguir
-- una máquina que se quitó de la carga antes de arrancar (línea tachada) de una
-- que terminó su ciclo. El flujo que las ponía en TRUE nunca se construyó: hoy
-- la única forma de quitar una máquina es quitar la carga entera, y en un año
-- de uso las dos columnas han sido FALSE en todas las filas.
--
-- Estado muerto que igual se lee: la pantalla mantenía una insignia "Eliminada"
-- imposible de ver y dos consultas del backend filtraban por una condición
-- siempre cierta. Eso confunde al leer el código y esconde el hecho de que
-- "quitar una máquina suelta" es una función que NO existe. Si el mostrador la
-- pide, se diseña de nuevo —con su endpoint— en vez de heredar media columna.
--
-- No se pierde nada: las dos columnas son FALSE en toda la tabla.

ALTER TABLE nota_cargas
  DROP COLUMN IF EXISTS lavadora_removida,
  DROP COLUMN IF EXISTS secadora_removida;
