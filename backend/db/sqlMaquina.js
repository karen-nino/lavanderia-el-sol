// Fragmentos de SQL sobre `maquinas` que usan varios controladores.
//
// Viven aquí y no copiados en cada consulta porque son reglas, no detalles de
// una pantalla: si cambian, tienen que cambiar en todas a la vez.

// Los minutos que `tiempos_marca` (mig. 107) tiene configurados para ESTA
// máquina, o NULL si su marca no tiene tiempo para su tipo y tamaño —o si ni
// siquiera tiene marca—. NULL significa "esta máquina se cronometra con el
// respaldo por tamaño de Ajustes", que es un tiempo supuesto, no medido.
//
// Se interpola en consultas donde la tabla `maquinas` va con el alias `m`, y
// no lleva parámetros: es una subconsulta correlacionada, no una plantilla con
// valores del usuario.
export const MINUTOS_DE_MARCA = `(
  SELECT tm.minutos
    FROM marcas_maquina mm
    JOIN tiempos_marca tm ON tm.marca_id = mm.id
   WHERE mm.nombre = m.marca
     AND tm.tipo = CASE WHEN m.tipo = 'secadora' THEN 'secadora' ELSE 'lavadora' END
     AND tm.tamano = m.tamano
)`;
