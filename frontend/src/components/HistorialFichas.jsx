import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatFechaHora12 } from '../lib/fecha';
import { periodoInicial, rangoDePeriodo } from '../lib/periodo';
import SelectorPeriodo from './SelectorPeriodo';

/** Qué pasó en un movimiento. */
const TIPO = {
  uso:     { label: 'Uso',        cls: 'bg-light-blue text-blue' },
  recoger: { label: 'Recogidas',  cls: 'bg-green-100 text-green-700' },
  ajuste:  { label: 'Corrección', cls: 'bg-gray-100 text-gray-600' },
};

/**
 * Historial de fichas en tabla, filtrado por período (como el de Caja): fecha,
 * movimiento, máquina, nota, fichas (+ entran / − salen), cuántas quedaron y
 * quién. `recarga` cambia cuando hubo un movimiento nuevo (recoger).
 */
export default function HistorialFichas({ recarga }) {
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const rango = rangoDePeriodo(periodo);
  const desde = rango?.desde.toISOString();
  const hasta = rango?.hasta.toISOString();

  useEffect(() => {
    if (!desde) return undefined;
    let vigente = true;
    api.get(`/fichas/historial?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)
      .then(d => { if (vigente) { setDatos(d); setError(''); } })
      .catch(err => { if (vigente) setError(err.message); });
    return () => { vigente = false; };
  }, [desde, hasta, recarga]);

  const movimientos = datos?.movimientos ?? [];
  const th = 'px-4 py-2.5 font-medium whitespace-nowrap';
  const td = 'px-4 py-2.5 whitespace-nowrap';

  return (
    /* Sin overflow-hidden: el panel del período tiene que poder salir de la tarjeta. */
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 space-y-3">
        <h2 className="text-base font-bold text-dark-blue">Historial</h2>
        <SelectorPeriodo valor={periodo} onCambio={setPeriodo} anios={datos?.anios} />
      </div>
      {error && <p className="px-5 pt-3 text-sm text-red-700">{error}</p>}
      {!rango ? (
        <p className="px-5 py-4 text-sm text-gray-500">Elige las fechas Desde y Hasta.</p>
      ) : !datos ? (
        !error && <p className="px-5 py-4 text-sm text-gray-400">Cargando…</p>
      ) : movimientos.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-500">Sin movimientos en este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-b-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className={th}>Fecha</th>
                <th className={th}>Movimiento</th>
                <th className={th}>Máquina</th>
                <th className={th}>Nota</th>
                <th className={`${th} text-right`}>Fichas</th>
                <th className={`${th} text-right`}>Quedan</th>
                <th className={th}>Quién</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movimientos.map(mv => {
                const tipo = TIPO[mv.tipo] ?? TIPO.ajuste;
                return (
                  <tr key={mv.id}>
                    <td className={`${td} text-gray-700`}>{formatFechaHora12(mv.created_at)}</td>
                    <td className={td}>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tipo.cls}`}>{tipo.label}</span>
                    </td>
                    <td className={`${td} text-gray-800`}>{mv.maquina_nombre ?? '—'}</td>
                    <td className={td}>
                      {mv.nota_id
                        ? <Link to={`/notas/${mv.nota_id}`} className="text-blue hover:underline">{mv.folio ?? `#${mv.nota_id}`}</Link>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className={`${td} text-right tabular-nums font-semibold ${mv.cantidad < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {mv.cantidad > 0 ? `+${mv.cantidad}` : mv.cantidad}
                    </td>
                    <td className={`${td} text-right tabular-nums text-gray-700`}>{mv.disponibles_despues}</td>
                    <td className={`${td} text-gray-600`}>{mv.usuario || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
