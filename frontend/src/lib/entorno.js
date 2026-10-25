/**
 * Build de la demo pública (VITE_ENTORNO_DEMO=1): base propia con datos
 * inventados, sin los recortes de la cuenta de prueba. La mitad del backend es
 * ENTORNO_DEMO (backend/utils/entorno.js).
 */
export const ES_DEMO = import.meta.env.VITE_ENTORNO_DEMO === '1';

/** La demo no ofrece el servicio de edredón: se esconde en todas las pantallas. */
export const CON_EDREDON = !ES_DEMO;
