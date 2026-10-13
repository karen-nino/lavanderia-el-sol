/**
 * Orientación de la app instalada: vertical en teléfonos, libre en tablets. No
 * se usa `orientation` del manifest porque se congela al instalar y es igual
 * para todos; aquí se pide al arrancar según el equipo. Si el navegador no lo
 * permite (Safari nunca), rota libre.
 */

import { estaInstalada } from './pwa';

/**
 * ¿Es un teléfono? (la tablet también es móvil). De la señal más fiable a la menos:
 * 1. Chromium: userAgentData.mobile (solo teléfonos).
 * 2. iPhone se identifica; el iPad se anuncia como Mac.
 * 3. Android: el UA del teléfono incluye "Mobile", el de la tablet no.
 * 4. Si nada aplica (escritorio), no se bloquea.
 */
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

/** Aplica la orientación del equipo y devuelve qué se hizo. */
export async function ajustarOrientacion() {
  // En una pestaña del navegador no se toca.
  if (!estaInstalada()) return 'no-instalada';
  if (!esTelefono()) return 'tablet';

  const orientacion = typeof screen !== 'undefined' ? screen.orientation : null;
  if (!orientacion || typeof orientacion.lock !== 'function') return 'no-soportado';

  try {
    await orientacion.lock('portrait');
    return 'bloqueada';
  } catch {
    // No permitido (Safari, algunos Android): queda libre, sin avisar.
    return 'no-permitida';
  }
}
