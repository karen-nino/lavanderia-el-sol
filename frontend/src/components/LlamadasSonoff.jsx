import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Ajustes → Sonoffs: llamadas a la nube de eWeLink en el mes contra el límite del
 * plan gratuito. El límite es uno para toda la cuenta; por sucursal se ve quién
 * gasta más. Al acabarse, los Sonoff dejan de obedecer hasta que se reinicia.
 */
const fmt = (n) => Number(n).toLocaleString('es-MX');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** 'YYYY-MM-DD' → '1 de noviembre'. */
const fechaLarga = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
};
/** 'YYYY-MM' → 'octubre 2026'. */
const mesLargo = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
};

/** Color de la barra según cuánto se ha gastado. */
const colorUso = (pct) => (pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500');

export default function LlamadasSonoff() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      setDatos(await api.get('/ewelink/llamadas'));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => {
    api.get('/ewelink/llamadas').then(setDatos).catch(err => setError(err.message));
  }, []);

  if (error) {
    return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>;
  }
  if (!datos) return <p className="text-sm text-gray-400">Cargando…</p>;

  const pct = Math.min(100, (datos.usadas / datos.limite) * 100);
  const sinLlamadas = datos.en_pausa_por_limite || datos.disponibles === 0;

  return (
    <div className="space-y-6">
      {sinLlamadas && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          Se acabaron las llamadas: eWeLink no deja prender ni apagar los Sonoff hasta que se reinicie el conteo.
        </div>
      )}

      {/* Total de la cuenta: lo comparten todas las sucursales. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-dark-blue">Llamadas de {mesLargo(datos.mes)}</h2>
            <p className="text-sm text-gray-500">Una sola cuenta de eWeLink para todas las sucursales</p>
          </div>
          <button
            type="button"
            onClick={cargar}
            disabled={cargando}
            className="flex-shrink-0 text-sm font-medium text-blue hover:underline disabled:opacity-60"
          >
            {cargando ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Usadas</p>
              <p className="text-2xl font-bold tabular-nums text-gray-900">{fmt(datos.usadas)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Disponibles</p>
              <p className={`text-2xl font-bold tabular-nums ${sinLlamadas ? 'text-red-600' : 'text-green-700'}`}>
                {fmt(datos.disponibles)}
              </p>
            </div>
          </div>
          <div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden" role="progressbar"
              aria-valuenow={datos.usadas} aria-valuemin={0} aria-valuemax={datos.limite}>
              <div className={`h-full ${colorUso(pct)} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-gray-500 tabular-nums">
              {pct.toFixed(1)}% de {fmt(datos.limite)} al mes
            </p>
          </div>
          <p className="text-sm text-gray-500">
            Se reinicia el <span className="font-medium text-gray-700">{fechaLarga(datos.reinicia)}</span>.
            eWeLink no publica el día exacto; se supone que es el 1 de cada mes.
          </p>
          {/* El conteo empezó con esta versión: lo de antes no quedó registrado. */}
          {datos.mes === '2026-10' && (
            <p className="text-sm text-amber-700">
              Se cuenta desde el 26 de octubre: las llamadas de antes no quedaron registradas.
            </p>
          )}
        </div>
      </div>

      {/* Por sucursal: quién gasta más del total. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-dark-blue">Por sucursal</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {datos.sucursales.map(s => (
            <div key={s.slug} className="px-5 py-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-800 min-w-0 truncate">{s.nombre}</span>
              <span className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">
                {fmt(s.llamadas)}
                {datos.usadas > 0 && (
                  <span className="font-normal text-gray-500"> · {Math.round((s.llamadas / datos.usadas) * 100)}%</span>
                )}
              </span>
            </div>
          ))}
          {datos.otras > 0 && (
            <div className="px-5 py-3 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-500 min-w-0">Sesión de la cuenta (renovar el acceso)</span>
              <span className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">{fmt(datos.otras)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
