// Instalación de la app desde el navegador (PWA).
//
// Android/Chrome avisa que la app se puede instalar con el evento
// `beforeinstallprompt`, y lo dispara UNA vez, muy temprano — normalmente antes
// de que React termine de montar. Por eso el evento se captura aquí, en un
// módulo que se importa desde main.jsx antes de renderizar: si se esperara al
// componente, el aviso ya habría pasado y el botón nunca aparecería.
//
// iPhone/iPad no tienen ese evento: Safari no deja instalar por código. Ahí lo
// único posible es explicar la ruta manual (Compartir → Agregar a inicio), que
// es lo que hace la pantalla de ayuda.

let promptDiferido = null;
const suscriptores = new Set();
const avisar = () => suscriptores.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin preventDefault, Chrome muestra su propia barra de instalación además
    // del botón del menú.
    e.preventDefault();
    promptDiferido = e;
    avisar();
  });

  window.addEventListener('appinstalled', () => {
    promptDiferido = null;
    avisar();
  });
}

// ¿La app ya corre instalada? (standalone en Android/escritorio, la propiedad
// de Safari en iOS). Si es así no hay nada que ofrecer.
export function estaInstalada() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  );
}

export function esIOS() {
  if (typeof navigator === 'undefined') return false;
  // El iPad con iPadOS 13+ se anuncia como Mac; lo delata la pantalla táctil.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// Estado de instalación para la interfaz.
//   comoInstalar: 'prompt' → hay diálogo nativo; 'ios' → hay que explicarlo;
//                 null     → no se puede ofrecer (ya instalada, o el navegador
//                            no la admite).
export function leerEstadoInstalacion() {
  if (estaInstalada()) return { disponible: false, comoInstalar: null };
  if (promptDiferido)  return { disponible: true,  comoInstalar: 'prompt' };
  if (esIOS())         return { disponible: true,  comoInstalar: 'ios' };
  return { disponible: false, comoInstalar: null };
}

export function suscribirse(fn) {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

// Lanza el diálogo del navegador. Devuelve 'aceptada' | 'rechazada' | 'no-hay'.
export async function lanzarInstalacion() {
  if (!promptDiferido) return 'no-hay';
  const evento = promptDiferido;
  // El evento es de un solo uso: se suelta antes de esperar la respuesta para
  // que un segundo clic no intente reutilizarlo.
  promptDiferido = null;
  avisar();
  try {
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    return outcome === 'accepted' ? 'aceptada' : 'rechazada';
  } catch {
    return 'rechazada';
  }
}
