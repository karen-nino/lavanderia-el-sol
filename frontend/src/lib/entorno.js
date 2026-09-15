// Build de la demostración pública (VITE_ENTORNO_DEMO=1).
//
// La demo corre sobre su propia base, llena de datos inventados, y entra con la
// cuenta de prueba. Esa cuenta normalmente tiene recortes pensados para el
// sistema real —no administra al personal ni cambia la configuración del
// negocio—, pero ahí no hay negocio que proteger: los recortes solo esconderían
// media app a quien vino a verla. El backend levanta los suyos con la variable
// ENTORNO_DEMO (ver backend/utils/entorno.js); esta es la mitad del frontend.
export const ES_DEMO = import.meta.env.VITE_ENTORNO_DEMO === '1';
