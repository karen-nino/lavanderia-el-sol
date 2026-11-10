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

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** 'YYYY-MM-DD' → 'lun 10'. */
const diaCorto = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return `${DIAS[new Date(a, m - 1, d).getDay()]} ${d}`;
};
/** Suma `delta` meses a 'YYYY-MM'. */
const moverMes = (mes, delta) => {
  const [a, m] = mes.split('-').map(Number);
  const f = new Date(a, m - 1 + delta, 1);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
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

  const avisoError = error && (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 flex items-center justify-between gap-3">
      <span>{error}</span>
      <button type="button" onClick={cargar} disabled={cargando}
        className="flex-shrink-0 font-medium text-red-700 underline disabled:opacity-60">
        Reintentar
      </button>
    </div>
  );
  if (!datos) return avisoError || <p className="text-sm text-gray-400">Cargando…</p>;

  const pct = Math.min(100, (datos.usadas / datos.limite) * 100);
  const sinLlamadas = datos.en_pausa_por_limite || datos.disponibles === 0;

  return (
    <div className="space-y-6">
      {avisoError}
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

      <HistorialLlamadas />
    </div>
  );
}

/** Historial por día y sucursal, un mes a la vez, del día más reciente al más viejo. */
function HistorialLlamadas() {
  const [mes, setMes] = useState(null);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    api.get(`/ewelink/llamadas/historial${mes ? `?mes=${mes}` : ''}`)
      .then(d => { if (vigente) { setDatos(d); setError(''); } })
      .catch(err => { if (vigente) setError(err.message); });
    return () => { vigente = false; };
  }, [mes]);

  if (!datos) {
    return error
      ? <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      : null;
  }

  const conSesion = datos.dias.some(d => d.otras > 0);
  const totalMes = datos.dias.reduce((t, d) => t + d.total, 0);
  const totalSucursal = (slug) => datos.dias.reduce((t, d) => t + (d.sucursales[slug] ?? 0), 0);
  const botonMes = 'w-10 h-10 flex items-center justify-center rounded-lg text-xl text-dark-blue hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-dark-blue">Historial por día</h2>
          <p className="text-sm text-gray-500 capitalize">{mesLargo(datos.mes)}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" aria-label="Mes anterior" className={botonMes}
            disabled={datos.mes <= datos.primer_mes} onClick={() => setMes(moverMes(datos.mes, -1))}>‹</button>
          <button type="button" aria-label="Mes siguiente" className={botonMes}
            disabled={datos.mes >= datos.mes_actual} onClick={() => setMes(moverMes(datos.mes, 1))}>›</button>
        </div>
      </div>
      {error && <p className="px-5 pt-3 text-sm text-red-700">{error}</p>}
      {datos.dias.length === 0 ? (
        <p className="px-5 py-5 text-sm text-gray-500">No hay llamadas registradas este mes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="px-5 py-2.5 font-medium">Día</th>
                {datos.sucursales.map(s => (
                  <th key={s.slug} className="px-3 py-2.5 font-medium text-right whitespace-nowrap">{s.nombre}</th>
                ))}
                {conSesion && <th className="px-3 py-2.5 font-medium text-right">Sesión</th>}
                <th className="px-5 py-2.5 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {datos.dias.map(d => (
                <tr key={d.dia}>
                  <td className="px-5 py-2.5 text-gray-800 whitespace-nowrap">{diaCorto(d.dia)}</td>
                  {datos.sucursales.map(s => (
                    <td key={s.slug} className="px-3 py-2.5 text-right text-gray-700">{fmt(d.sucursales[s.slug] ?? 0)}</td>
                  ))}
                  {conSesion && <td className="px-3 py-2.5 text-right text-gray-500">{fmt(d.otras)}</td>}
                  <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{fmt(d.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <td className="px-5 py-2.5">Mes</td>
                {datos.sucursales.map(s => (
                  <td key={s.slug} className="px-3 py-2.5 text-right">{fmt(totalSucursal(s.slug))}</td>
                ))}
                {conSesion && <td className="px-3 py-2.5 text-right">{fmt(datos.dias.reduce((t, d) => t + d.otras, 0))}</td>}
                <td className="px-5 py-2.5 text-right">{fmt(totalMes)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
