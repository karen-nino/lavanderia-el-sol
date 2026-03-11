import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Insumos() {
  const [insumos, setInsumos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/insumos')
      .then(setInsumos)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stockBajo = insumos.filter(i => Number(i.stock_actual) <= Number(i.stock_minimo));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Insumos</h1>
        <p className="text-sm text-gray-500">{insumos.length} producto(s) en inventario</p>
      </div>

      {/* Alerta stock bajo */}
      {stockBajo.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-semibold text-amber-800">
              Stock bajo en {stockBajo.length} producto(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stockBajo.map(i => (
              <span key={i.id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                {i.nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {insumos.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No hay insumos registrados</p>
          ) : (
            <>
              {/* Tabla — desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Insumo</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Unidad</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Stock actual</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Stock mínimo</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Precio unit.</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {insumos.map(i => {
                      const bajo = Number(i.stock_actual) <= Number(i.stock_minimo);
                      return (
                        <tr key={i.id} className={`hover:bg-gray-50 transition-colors ${bajo ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{i.nombre}</p>
                            {i.descripcion && <p className="text-xs text-gray-400">{i.descripcion}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{i.unidad}</td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${bajo ? 'text-red-600' : 'text-gray-800'}`}>
                            {Number(i.stock_actual).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-400">
                            {Number(i.stock_minimo).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {i.precio_unitario ? `$${Number(i.precio_unitario).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {bajo ? (
                              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                                Stock bajo
                              </span>
                            ) : (
                              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                                OK
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden divide-y divide-gray-50">
                {insumos.map(i => {
                  const bajo = Number(i.stock_actual) <= Number(i.stock_minimo);
                  return (
                    <div key={i.id} className={`px-4 py-3 ${bajo ? 'bg-amber-50/40' : ''}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-800 text-sm">{i.nombre}</p>
                        {bajo ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            Stock bajo
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            OK
                          </span>
                        )}
                      </div>
                      <p className={`text-sm font-mono mt-1 ${bajo ? 'text-red-600' : 'text-gray-600'}`}>
                        {Number(i.stock_actual).toFixed(2)} / {Number(i.stock_minimo).toFixed(2)} {i.unidad}
                      </p>
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
