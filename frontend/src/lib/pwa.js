/**
 * Instalación como PWA. Chrome dispara `beforeinstallprompt` una vez y muy
 * temprano, así que se captura aquí (se importa desde main.jsx antes de
 * renderizar). iPhone/iPad no lo tienen: ahí se explica la ruta manual.
 */

let promptDiferido = null;
const suscriptores = new Set();
const avisar = () => suscriptores.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin preventDefault, Chrome muestra además su barra de instalación.
    e.preventDefault();
    promptDiferido = e;
    avisar();
  });

  window.addEventListener('appinstalled', () => {
    promptDiferido = null;
    avisar();
  });
}

/** ¿Ya corre instalada? (standalone, o la propiedad de Safari en iOS). */
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

/**
 * Estado para la interfaz. `comoInstalar`: 'prompt' (diálogo nativo), 'ios'
 * (explicarlo) o null (ya instalada o no se admite).
 */
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
  // El evento es de un solo uso: se suelta antes de esperar la respuesta.
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
