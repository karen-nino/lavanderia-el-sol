-- Migración 111: tiempos de secadora por marca
-- Fecha: 2026-09-17
--
-- La 107 sembró los tiempos por marca solo de las lavadoras, que eran las que
-- tenían el problema: su duración real dependía de la marca y no del tamaño.
-- Las secadoras se quedaron con el respaldo por tamaño de Ajustes (30 min para
-- todas) porque ninguna tenía marca asignada.
--
-- Ahora el negocio quiere registrarlas igual: Samsung y Speed Queen, 30 min.
-- Hoy el número coincide con el respaldo, así que NO cambia ningún
-- comportamiento — la duración sigue siendo 30 mire por donde se mire. Lo que
-- cambia es que el dato queda donde toca: el día que una marca resulte más
-- lenta, se edita su fila y solo se mueven sus secadoras, sin arrastrar a las
-- demás.
--
-- Solo el tamaño 'mediana': el formulario de Gestión de Máquinas no ofrece
-- tamaño para las secadoras ("la secadora es de un solo tamaño"), así que todas
-- se dan de alta como medianas. Una secadora jumbo heredada seguiría cayendo al
-- respaldo de Ajustes, que también son 30.
--
-- Sembrar la fila ANTES de asignar la marca es a propósito: `getTiemposMarca`
-- arma la lista de combinaciones con lo que hay en esta tabla además de lo que
-- hay en las máquinas, así que la fila aparece en Ajustes desde ya y con su
-- valor puesto. Cuando el admin le ponga marca a cada secadora, el tiempo ya
-- está esperándola.

INSERT INTO tiempos_marca (marca_id, tipo, tamano, minutos)
SELECT id, 'secadora', 'mediana', 30 FROM marcas_maquina WHERE nombre = 'Samsung'
UNION ALL
SELECT id, 'secadora', 'mediana', 30 FROM marcas_maquina WHERE nombre = 'Speed Queen'
ON CONFLICT (marca_id, tipo, tamano) DO NOTHING;
