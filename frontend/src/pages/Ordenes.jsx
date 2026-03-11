import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const ESTADOS = ['TODOS', 'RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];

const BADGE = {
  RECIBIDO:   { label: 'Recibido',   cls: 'bg-yellow-100 text-yellow-800' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-blue-100 text-blue-800' },
  LISTO:      { label: 'Listo',      cls: 'bg-green-100 text-green-800' },
  ENTREGADO:  { label: 'Entregado',  cls: 'bg-gray-100 text-gray-500' },
};

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtMonto(n) {
  return n ? `$${Number(n).toFixed(2)}` : '—';
}

export default function Ordenes() {
  const [ordenes, setOrdenes] = useState([]);
  const [filtro, setFiltro] = useState('TODOS');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ordenes')
      .then(setOrdenes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtradas = filtro === 'TODOS'
    ? ordenes
    : ordenes.filter(o => o.estado === filtro);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Órdenes</h1>
          <p className="text-sm text-gray-500">{filtradas.length} resultado(s)</p>
        </div>
        <Link
          to="/ordenes/nueva"
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0"
        >
          + Nueva
        </Link>
      </div>

      {/* Filtros de estado */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {ESTADOS.map(e => (
          <button
            key={e}
            onClick={() => setFiltro(e)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filtro === e
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'
            }`}
          >
            {e === 'TODOS' ? 'Todos' : BADGE[e]?.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {filtradas.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm">No hay órdenes con este filtro</p>
            </div>
          ) : (
            <>
              {/* Tabla — desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Folio</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Peso</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtradas.map(o => {
                      const badge = BADGE[o.estado] ?? BADGE.RECIBIDO;
                      return (
                        <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            {o.folio ?? `#${o.id}`}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{o.cliente_nombre}</p>
                            <p className="text-xs text-gray-400">{o.cliente_telefono}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {o.peso_kg ? `${o.peso_kg} kg` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {fmtMonto(o.precio_total)}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {fmtFecha(o.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden divide-y divide-gray-50">
                {filtradas.map(o => {
                  const badge = BADGE[o.estado] ?? BADGE.RECIBIDO;
                  return (
                    <div key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-gray-400">{o.folio ?? `#${o.id}`}</p>
                        <p className="font-medium text-gray-800 text-sm truncate">{o.cliente_nombre}</p>
                        <p className="text-xs text-gray-400">
                          {fmtFecha(o.created_at)}
                          {o.precio_total ? ` · ${fmtMonto(o.precio_total)}` : ''}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
