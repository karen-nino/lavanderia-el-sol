import { useEffect, useRef, useState } from 'react';
import MaquinasEnUso from '../components/MaquinasEnUso';
import SucursalBar from '../components/SucursalBar';
import { tiempoRelativo } from '../lib/fecha';

export default function Maquinas() {
  const monitorRef = useRef(null);
  const [refrescando, setRefrescando] = useState(false);
  const [enUso, setEnUso] = useState(0);
  // Estado del refresco que reporta el monitor: cuándo trajo datos por última
  // vez y si la recarga manual falló.
  const [estado, setEstado] = useState({ ultimaActualizacion: null, errorRefresco: '' });
  // Reloj propio: la marca "Actualizado hace X" tiene que envejecer sola.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
            {estado.errorRefresco ? (
              <p className="text-sm text-red-600">{estado.errorRefresco}</p>
            ) : estado.ultimaActualizacion && (
              <p className="text-sm text-gray-400">
                Actualizado {tiempoRelativo(estado.ultimaActualizacion, now)}
              </p>
            )}
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

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-6">
        <MaquinasEnUso
          ref={monitorRef}
          showHeader={false}
          onCountChange={setEnUso}
          onEstadoRefresco={setEstado}
        />
      </div>
    </div>
  );
}
