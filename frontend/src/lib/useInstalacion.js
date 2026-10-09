import { useEffect, useState } from 'react';
import { leerEstadoInstalacion, suscribirse, estaInstalada } from './pwa';

// ¿Hay algo que ofrecerle a este equipo sobre instalar la app, y de qué forma?
//
// La sección de Ajustes se muestra siempre; esto decide qué dice: si ya está
// instalada, si hay diálogo nativo, o si toca explicar la ruta manual.
// El aviso de Chrome puede llegar después de pintar la pantalla, de ahí la
// suscripción.
export function useInstalacion() {
  const [estado, setEstado] = useState(leerEstadoInstalacion);
  const [instalada, setInstalada] = useState(estaInstalada);

  useEffect(() => suscribirse(() => {
    setEstado(leerEstadoInstalacion());
    setInstalada(estaInstalada());
  }), []);

  return {
    // 'prompt' → hay diálogo nativo; 'ios' → pasos de Safari; 'manual' → el
    // navegador no avisó (ya se descartó el aviso, o no lo admite) y se
    // explica cómo hacerlo desde su menú.
    comoInstalar: estado.comoInstalar ?? 'manual',
    instalada,
    // Para adelantarse al evento `appinstalled` cuando el diálogo se acepta.
    marcarInstalada: () => setInstalada(true),
  };
}
