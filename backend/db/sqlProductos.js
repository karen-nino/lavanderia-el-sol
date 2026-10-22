// Reglas en SQL sobre los productos de una nota, compartidas por el total, la
// caja y Ventas: tienen que cambiar en todas las consultas a la vez.

/**
 * Lo que una línea de `nota_productos` de una nota Por Encargo cobra aparte del
 * precio de los servicios (alias de nota_productos, productos y notas):
 * - marca y polvo (se venden por unidad): completos;
 * - la bolsa suelta: solo las de más. Cada servicio incluye las de Ajustes,
 *   congeladas en `nota_cargas.bolsas_incluidas` (las notas de antes de la
 *   mig. 166 las incluyen todas);
 * - lo demás (granel, material dentro de un servicio): nada, va en el servicio.
 */
export const COBRO_APARTE_ENCARGO = (np, a, n) => `(CASE
  WHEN ${a}.se_vende_por_unidad THEN ${np}.cantidad * ${np}.precio_unitario
  WHEN ${a}.clase = 'bolsa' AND ${np}.carga_id IS NULL AND NOT ${n}.bolsas_todas_incluidas
    THEN GREATEST(0, ${np}.cantidad - COALESCE((
           SELECT SUM(ncb.bolsas_incluidas) FROM nota_cargas ncb
            WHERE ncb.nota_id = ${np}.nota_id AND ncb.bolsa_producto_id = ${np}.producto_id), 0))
         * ${np}.precio_unitario
  ELSE 0 END)`;
