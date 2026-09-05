import { useState } from 'react';
import { lanzarInstalacion } from '../lib/pwa';
import { useInstalacion } from '../lib/useInstalacion';

// Botón para instalar la app en el teléfono o la tablet, desde Ajustes.
//
// Se comporta distinto según el equipo, porque los navegadores no ofrecen lo
// mismo:
//   · Android/Chrome y escritorio → hay un diálogo nativo que se lanza al
//     tocar el botón.
//   · iPhone/iPad → Safari NO deja instalar por código. Lo único posible es
//     explicar la ruta manual, así que el botón abre esa ayuda.
// Si la app ya está instalada (se abrió desde su ícono), no se muestra nada:
// ofrecer "instalar" a alguien que ya la tiene solo confunde.

const IconoInstalar = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>
);

const IconoCompartir = (
  <svg className="w-5 h-5 inline-block align-text-bottom" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 4v12m0-12L8.5 7.5M12 4l3.5 3.5M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6" />
  </svg>
);

function AyudaIPhone({ onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-base font-bold text-gray-900 mb-1">Instalar en iPhone o iPad</h3>
          <p className="text-sm text-gray-500 mb-4">
            En iPhone la instalación se hace desde el navegador, en tres pasos:
          </p>
          <ol className="space-y-3 text-sm text-gray-700">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-light-blue/60 text-blue font-bold text-xs flex items-center justify-center">1</span>
              <span>
                Abre esta página en <span className="font-semibold">Safari</span> y toca el botón
                Compartir {IconoCompartir}, abajo en la barra.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-light-blue/60 text-blue font-bold text-xs flex items-center justify-center">2</span>
              <span>
                Baja en la lista y toca <span className="font-semibold">"Agregar a inicio"</span>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-light-blue/60 text-blue font-bold text-xs flex items-center justify-center">3</span>
              <span>
                Toca <span className="font-semibold">Agregar</span>. La app queda con su ícono en la
                pantalla de inicio y se abre sin la barra del navegador.
              </span>
            </li>
          </ol>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InstalarApp({ variant = 'desktop' }) {
  const { comoInstalar, sePuedeInstalar, marcarInstalada } = useInstalacion();
  const [ayudaIOS, setAyudaIOS] = useState(false);

  const handleInstalar = async () => {
    if (comoInstalar === 'ios') { setAyudaIOS(true); return; }
    const r = await lanzarInstalacion();
    if (r === 'aceptada') marcarInstalada();
  };

  if (!sePuedeInstalar) return null;

  const descripcion = comoInstalar === 'ios'
    ? 'Queda con su ícono en la pantalla de inicio y se abre sin la barra del navegador. Te explicamos cómo.'
    : 'Queda con su ícono en la pantalla de inicio y se abre sin la barra del navegador, como cualquier app.';

  const boton = (
    <button
      type="button"
      onClick={handleInstalar}
      className="flex items-center justify-center gap-2 w-full md:w-auto px-6 py-3.5 bg-blue hover:opacity-90 text-white text-base font-medium rounded-lg transition-colors"
    >
      {IconoInstalar}
      {comoInstalar === 'ios' ? 'Cómo instalarla' : 'Instalar app'}
    </button>
  );

  // Móvil: el contenido de su propia sección de Ajustes, que ya pone el título
  // arriba. Escritorio: dentro del marco de sección que usan las demás.
  if (variant === 'mobile') {
    return (
      <>
        <p className="text-base text-grey leading-relaxed">{descripcion}</p>
        {boton}
        {ayudaIOS && <AyudaIPhone onClose={() => setAyudaIOS(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-dark-blue">Instalar la app</h2>
        </div>
        <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-600 max-w-md">{descripcion}</p>
          {boton}
        </div>
      </div>
      {ayudaIOS && <AyudaIPhone onClose={() => setAyudaIOS(false)} />}
    </>
  );
}
