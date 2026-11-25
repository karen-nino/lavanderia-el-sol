import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TablaFichasTurno } from './FichasPorTurno';

/**
 * Fichas del turno abierto en Corte de caja: acordeón cerrado de inicio, solo si
 * la sucursal usa fichas. `caja` es la caja abierta.
 */
export default function FichasCorte({ caja }) {
  const [abierto, setAbierto] = useState(false);
  const [usaFichas, setUsaFichas] = useState(false);
  const [turno, setTurno] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    api.get('/fichas')
      .then(d => { if (vigente) setUsaFichas(Boolean(d?.usa_fichas)); })
      .catch(() => {});
    return () => { vigente = false; };
  }, []);

  /* Se piden al abrir el acordeón (y de nuevo cada vez, para que estén al día). */
  useEffect(() => {
    if (!abierto || !usaFichas) return undefined;
    let vigente = true;
    const desde = encodeURIComponent(caja.abierta_at);
    const hasta = encodeURIComponent(new Date().toISOString());
    api.get(`/fichas/turnos?desde=${desde}&hasta=${hasta}`)
      .then(d => {
        if (!vigente) return;
        setTurno((d?.turnos ?? []).find(t => String(t.id) === String(caja.id)) ?? false);
        setError('');
      })
      .catch(err => { if (vigente) setError(err.message); });
    return () => { vigente = false; };
  }, [abierto, usaFichas, caja.id, caja.abierta_at]);

  if (!usaFichas) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-lg font-semibold text-blue">Fichas</span>
        <svg className={`w-4 h-4 flex-shrink-0 text-gray-500 transition-transform ${abierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {abierto && (
        error ? <p className="px-4 py-3.5 text-base text-red-700">{error}</p>
          : turno === null ? <p className="px-4 py-3.5 text-base text-gray-400">Cargando…</p>
          : !turno ? <p className="px-4 py-3.5 text-base text-gray-500">Sin fichas en este turno.</p>
          : <TablaFichasTurno t={turno} grande />
      )}
    </div>
  );
}
