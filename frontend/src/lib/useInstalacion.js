import { useEffect, useState } from 'react';
import { leerEstadoInstalacion, suscribirse, estaInstalada } from './pwa';

/**
 * Qué decir sobre instalar la app: ya instalada, diálogo nativo o ruta manual.
 * Se suscribe porque el aviso de Chrome puede llegar después de pintar.
 */
export function useInstalacion() {
  const [estado, setEstado] = useState(leerEstadoInstalacion);
  const [instalada, setInstalada] = useState(estaInstalada);

  useEffect(() => suscribirse(() => {
    setEstado(leerEstadoInstalacion());
    setInstalada(estaInstalada());
  }), []);

  return {
    // 'prompt' → diálogo nativo; 'ios' → pasos de Safari; 'manual' → explicar desde el menú.
    comoInstalar: estado.comoInstalar ?? 'manual',
    instalada,
    // Para adelantarse a `appinstalled` al aceptar el diálogo.
    marcarInstalada: () => setInstalada(true),
  };
}
