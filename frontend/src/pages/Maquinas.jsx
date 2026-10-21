import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MaquinasEnUso from '../components/MaquinasEnUso';
import SucursalBar from '../components/SucursalBar';
import ReporteDiarioMaquinas from '../components/ReporteDiarioMaquinas';

export default function Maquinas() {
  const monitorRef = useRef(null);
  const [refrescando, setRefrescando] = useState(false);
  const [enUso, setEnUso] = useState(0);
  // Aviso que reporta el monitor cuando la recarga manual falla.
  const [errorRefresco, setErrorRefresco] = useState('');
  // Vista: las máquinas en vivo o el Reporte diario; se cambia con el botón de la cabecera.
  const [vista, setVista] = useState('maquinas');
  const enReporte = vista === 'reporte';

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
        <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
            <p className="text-sm text-gray-500">{enReporte ? 'Reporte diario' : `Máquinas en uso (${enUso})`}</p>
            {!enReporte && errorRefresco && <p className="text-sm text-red-600">{errorRefresco}</p>}
          </div>
          <div className="flex items-center gap-3">
          {/* Cambia entre las máquinas y el Reporte diario (como en Inventario). */}
          <button
            type="button"
            onClick={() => setVista(v => (v === 'reporte' ? 'maquinas' : 'reporte'))}
            aria-label={enReporte ? 'Ver máquinas' : 'Ver reporte diario'}
            title={enReporte ? 'Ver máquinas' : 'Ver reporte diario'}
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors flex-shrink-0 ${
              enReporte
                ? 'border-blue bg-light-blue text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {enReporte ? (
              /* Lista */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            ) : (
              /* Reporte */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
          </button>
          {!enReporte && (
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
              {/* En espejo: se voltea el dibujo y no el <svg>, para que el giro no lo deshaga. */}
              <g transform="matrix(-1 0 0 1 24 0)">
                <path d="M20 11A8.1 8.1 0 004.5 9M4 5v4h4" />
                <path d="M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
              </g>
            </svg>
          </button>
          )}
          </div>
        </div>
      </div>

      <SucursalBar />

      {/* Espacio abajo para que el botón flotante no tape el Finalizar de la última tarjeta. */}
      <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-6 pb-28">
        {enReporte ? <ReporteDiarioMaquinas /> : (
          <MaquinasEnUso
            ref={monitorRef}
            showHeader={false}
            onCountChange={setEnUso}
            onErrorRefresco={setErrorRefresco}
          />
        )}
      </div>

      {/* Crear nota, el mismo botón flotante del Dashboard. */}
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
