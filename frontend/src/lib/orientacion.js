// Bloqueo de orientación de la app instalada: vertical en teléfonos, libre en
// tablets.
//
// El manifest tiene un campo `orientation` que haría esto en una línea, pero no
// sirve aquí: el navegador lo congela AL INSTALAR, y como el archivo es el
// mismo para todos, o se bloquean todos o ninguno. Encima, equivocarse por ahí
// deja la tablet clavada en vertical hasta que alguien la reinstale.
//
// Por eso el bloqueo se pide al arrancar, ya sabiendo en qué equipo estamos. Si
// el navegador no lo permite, no pasa nada: la app rota libre, que es como se
// comporta cualquier app sin bloqueo. La detección se re-evalúa en cada
// arranque, así que un error nunca queda grabado.
//
// Nota sobre iPhone/iPad: Safari no admite bloquear la orientación por código,
// así que ahí siempre rota libre. No hay forma de evitarlo.

import { estaInstalada } from './pwa';

// ¿Es un TELÉFONO? (no basta con "es móvil": la tablet también lo es).
//
// No hay una señal infalible, así que se van probando de la más fiable a la
// menos:
//   1. Chromium lo dice de frente en userAgentData.mobile — true solo en
//      teléfonos, false en tablets y escritorio.
//   2. El iPad se anuncia como Mac desde iPadOS 13, pero el iPhone sí se
//      identifica.
//   3. En Android, el UA de los teléfonos incluye "Mobile" y el de las tablets
//      lo omite. Es la distinción que documenta el propio Chrome.
//   4. Si nada aplica (escritorio), no se bloquea nada.
export function esTelefono(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;

  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    return nav.userAgentData.mobile;
  }

  const ua = String(nav.userAgent ?? '');
  if (/iPad/.test(ua)) return false;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/Android/i.test(ua)) return /Mobile/.test(ua);
  return false;
}

// Aplica la orientación que le toca a este equipo.
// Devuelve qué se hizo, para poder probarlo y para dejarlo en el log.
export async function ajustarOrientacion() {
  // En una pestaña del navegador no se toca: la orientación es del navegador,
  // no nuestra. Esto solo aplica a la app instalada.
  if (!estaInstalada()) return 'no-instalada';
  if (!esTelefono()) return 'tablet';

  const orientacion = typeof screen !== 'undefined' ? screen.orientation : null;
  if (!orientacion || typeof orientacion.lock !== 'function') return 'no-soportado';

  try {
    await orientacion.lock('portrait');
    return 'bloqueada';
  } catch {
    // Safari y algunos Android no lo permiten. Se queda libre: es exactamente
    // lo que pasaría sin este código, así que no hay nada que avisar.
    return 'no-permitida';
  }
}
