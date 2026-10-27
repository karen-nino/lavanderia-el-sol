import { useEffect, useState } from 'react';
import { APP_VERSION } from '../lib/version';
import { hayQueActualizar, versionPublicada, aplicarActualizacion } from '../lib/actualizacion';

const IconoActualizar = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

/**
 * Actualizar App desde Ajustes: la versión de este equipo, la publicada y el
 * botón. Sin versión nueva el botón igual recarga (por si algo quedó atorado).
 */
export default function ActualizarApp({ variant = 'desktop' }) {
  const [publicada, setPublicada] = useState(null);
  const [buscando, setBuscando] = useState(true);
  const [actualizando, setActualizando] = useState(false);

  useEffect(() => {
    let vivo = true;
    versionPublicada().then((v) => {
      if (!vivo) return;
      setPublicada(v);
      setBuscando(false);
    });
    return () => { vivo = false; };
  }, []);

  const hay = hayQueActualizar(publicada);

  const descripcion = buscando
    ? 'Buscando si hay una versión nueva…'
    : hay
      ? `Hay una versión nueva: la ${publicada}. Actualiza para tener lo más reciente; sigues con tu sesión abierta.`
      : publicada
        ? 'Ya tienes la versión más reciente.'
        : 'No se pudo revisar si hay una versión nueva. Revisa tu conexión o recarga la app.';

  const boton = (
    <button
      type="button"
      onClick={async () => { setActualizando(true); await aplicarActualizacion(); }}
      disabled={actualizando || buscando}
      className={`flex items-center justify-center gap-2 w-full md:w-auto px-6 py-3.5 text-base font-medium rounded-lg transition-colors disabled:opacity-60 ${
        hay ? 'bg-blue hover:opacity-90 text-white' : 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
      }`}
    >
      {IconoActualizar}
      {actualizando ? 'Actualizando…' : hay ? `Actualizar a la ${publicada}` : 'Recargar la app'}
    </button>
  );

  const version = <p className="text-sm text-gray-500">Versión de este equipo: {APP_VERSION}</p>;

  if (variant === 'mobile') {
    return (
      <>
        <p className="text-base text-grey leading-relaxed">{descripcion}</p>
        {boton}
        {version}
      </>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-base font-bold text-dark-blue">Actualizar App</h2>
      </div>
      <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1 max-w-md">
          <p className="text-sm text-gray-600">{descripcion}</p>
          {version}
        </div>
        {boton}
      </div>
    </div>
  );
}
