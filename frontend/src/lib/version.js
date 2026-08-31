// Versión de la app, tomada de package.json en tiempo de build (ver el `define`
// de vite.config.js). El fallback cubre entornos donde no se inyecta.
export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Zona horaria del negocio: el "día" se corta a medianoche local, igual que el
// cierre del día del backend (jobs/cierreDelDia.js, CIERRE_HORA por defecto 0).
const TZ = 'America/Mexico_City';
const CLAVE = 'appVersionVista';

const fmtDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

// Día del negocio ('YYYY-MM-DD') para la fecha dada.
const diaNegocio = (fecha = new Date()) => fmtDia.format(fecha);

// ¿Se estrena esta versión? Sirve para marcarla como nueva en el login. La
// marca se enciende la primera vez que este dispositivo ve la versión y se
// apaga en el siguiente cierre del día, no al recargar: si desapareciera al
// primer vistazo, el segundo turno del día nunca se enteraría.
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
