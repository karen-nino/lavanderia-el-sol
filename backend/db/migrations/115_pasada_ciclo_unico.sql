-- Migración 115: la vuelta extra de una carga corre un solo ciclo
-- Fecha: 2026-09-22
--
-- Una carga de ropa necesita dos ciclos seguidos en las lavadoras con tiempo de
-- marca (mig. 108), y el tope sale de la MÁQUINA: marca conocida → 2, sin marca
-- o secadora → 1.
--
-- Eso vale para el lavado que la nota compró. La vuelta EXTRA que se agrega
-- desde Salidas —relavar, secar de más— es otra cosa: va sin cobro, y darle
-- dos ciclos más es regalar el doble de agua y luz sobre un lavado que ya se
-- cobró una vez. Esa vuelta corre un ciclo y punto.
--
-- El dato es de la PASADA, no de la máquina ni de la carga: la misma lavadora
-- puede correr dos ciclos en el lavado de la nota y uno solo en el relavado de
-- media hora después. Por eso vive en el historial de la mig. 114.

ALTER TABLE nota_carga_maquinas
  ADD COLUMN IF NOT EXISTS ciclo_unico BOOLEAN NOT NULL DEFAULT FALSE;
