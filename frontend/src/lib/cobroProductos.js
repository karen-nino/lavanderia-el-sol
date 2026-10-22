import { seVendePorUnidad } from './formatoInventario';

/** Bolsas de ese producto que incluyen los servicios de la nota (congeladas al crearla). */
export function bolsasIncluidas(nota, productoId) {
  return (nota?.cargas ?? [])
    .filter(c => String(c.bolsa_producto_id) === String(productoId))
    .reduce((s, c) => s + (Number(c.bolsas_incluidas) || 0), 0);
}

/**
 * Lo que un producto suelto de una nota Por Encargo cobra aparte del precio de
 * los servicios, como COBRO_APARTE_ENCARGO del servidor: marca y polvo,
 * completos; la bolsa, solo las de más; el granel, nada.
 */
export function cobroAparteEncargo(nota, p) {
  const subtotal = Number(p.subtotal ?? Number(p.cantidad) * Number(p.precio_unitario)) || 0;
  if (seVendePorUnidad(p)) return subtotal;
  if (p.clase === 'bolsa' && p.carga_id == null && !nota?.bolsas_todas_incluidas) {
    const deMas = Math.max(0, Number(p.cantidad) - bolsasIncluidas(nota, p.producto_id));
    return deMas * Number(p.precio_unitario);
  }
  return 0;
}
