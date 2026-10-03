import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MaquinasEnUso from '../components/MaquinasEnUso';
import SucursalBar from '../components/SucursalBar';

export default function Maquinas() {
  const monitorRef = useRef(null);
  const [refrescando, setRefrescando] = useState(false);
  const [enUso, setEnUso] = useState(0);
  // Aviso que reporta el monitor cuando la recarga manual falla.
  const [errorRefresco, setErrorRefresco] = useState('');

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
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
            <p className="text-sm text-gray-500">Máquinas en uso ({enUso})</p>
            {errorRefresco && <p className="text-sm text-red-600">{errorRefresco}</p>}
          </div>
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

      <SucursalBar />

      {/* Contenido. El espacio de abajo es para que el botón flotante de
          nueva nota no tape el Finalizar de la última tarjeta. */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-6 pb-28">
        <MaquinasEnUso
          ref={monitorRef}
          showHeader={false}
          onCountChange={setEnUso}
          onErrorRefresco={setErrorRefresco}
        />
      </div>

      {/* Crear nota desde aquí, el mismo botón flotante del Dashboard: en el
          mostrador se pasa de ver las máquinas a hacer la nota del cliente. */}
      <Link
        to="/notas/nueva"
        aria-label="Nueva nota"
        className="fixed bottom-fab-safe right-4 md:bottom-8 md:right-8 w-16 h-16 rounded-pill bg-blue text-white shadow-card flex items-center justify-center hover:opacity-90 transition duration-200 ease-out active:scale-[1.3] active:shadow-lg z-40"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>
    </div>
  );
}
