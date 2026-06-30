import { useRef, useState } from 'react';
import MaquinasEnUso from '../components/MaquinasEnUso';

export default function Maquinas() {
  const monitorRef = useRef(null);
  const [refrescando, setRefrescando] = useState(false);

  const refrescar = async () => {
    setRefrescando(true);
    try {
      await monitorRef.current?.refrescar();
    } finally {
      setRefrescando(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
          <button
            type="button"
            onClick={refrescar}
            disabled={refrescando}
            aria-label="Recargar máquinas"
            title="Recargar"
            className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center disabled:opacity-60 transition-colors flex-shrink-0"
          >
            <svg
              className={`w-5 h-5 ${refrescando ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
            >
              <path d="M20 11A8.1 8.1 0 004.5 9M4 5v4h4" />
              <path d="M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Contenido */}
      <div className="px-6 md:px-8 py-6">
        <MaquinasEnUso ref={monitorRef} showHeaderButton={false} />
      </div>
    </div>
  );
}
