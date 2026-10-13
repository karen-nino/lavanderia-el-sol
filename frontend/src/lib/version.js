/** Versión de package.json, inyectada en el build (`define` de vite.config.js). */
export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Zona del negocio: el día se corta a medianoche local, como el cierre del día del backend. */
const TZ = 'America/Mexico_City';
const CLAVE = 'appVersionVista';

const fmtDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

// Día del negocio ('YYYY-MM-DD') para la fecha dada.
const diaNegocio = (fecha = new Date()) => fmtDia.format(fecha);

/**
 * ¿Se estrena esta versión? (para marcarla en el login). Se enciende la primera
 * vez que el equipo la ve y se apaga en el siguiente cierre del día, no al
 * recargar.
 */
export function versionEsNueva() {
  const hoy = diaNegocio();
  let visto = null;
  try {
    visto = JSON.parse(localStorage.getItem(CLAVE) || 'null');
  } catch {
    visto = null; // dato corrupto: se trata como si no hubiera nada
  }

  if (!visto || visto.version !== APP_VERSION) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ version: APP_VERSION, dia: hoy }));
    } catch {
      /* sin localStorage (modo privado): la marca solo dura esta carga */
    }
    return true;
  }
  return visto.dia === hoy;
}
