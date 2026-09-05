import { useEffect, useState } from 'react';
import { leerEstadoInstalacion, suscribirse, estaInstalada } from './pwa';

// ¿Hay algo que ofrecerle a este equipo sobre instalar la app, y de qué forma?
//
// Vive aparte porque lo consultan dos lugares: el componente que dibuja la
// oferta y la pantalla de Ajustes, que decide si pone la fila en su menú.
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
    // 'prompt' → hay diálogo nativo; 'ios' → hay que explicar la ruta manual.
    comoInstalar: estado.comoInstalar,
    // Falso si ya la tiene instalada o si su navegador no la admite: ofrecerle
    // "instalar" a quien ya la tiene solo confunde.
    sePuedeInstalar: !instalada && estado.disponible,
    // Para adelantarse al evento `appinstalled` cuando el diálogo se acepta.
    marcarInstalada: () => setInstalada(true),
  };
}
