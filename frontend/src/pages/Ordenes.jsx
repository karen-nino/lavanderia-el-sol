import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ESTADOS = ['TODOS', 'ACTIVA', 'EN_PROCESO', 'LISTA', 'PAGADA', 'ENTREGADA', 'CANCELADA'];

const BADGE_ESTADO = {
  ACTIVA:     { label: 'Activa',     cls: 'bg-gray-100 text-gray-700'       },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-blue-100 text-blue-800'       },
  LISTA:      { label: 'Lista',      cls: 'bg-yellow-100 text-yellow-800'   },
  PAGADA:     { label: 'Pagada',     cls: 'bg-emerald-100 text-emerald-800' },
  ENTREGADA:  { label: 'Entregada',  cls: 'bg-green-800 text-white'         },
  CANCELADA:  { label: 'Cancelada',  cls: 'bg-red-100 text-red-700'         },
};

const BADGE_MODALIDAD = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-purple-100 text-purple-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por encargo',  cls: 'bg-amber-100 text-amber-700'   },
};

const BADGE_PAGO = {
  DEBE:   { label: 'Debe',   cls: 'bg-red-100 text-red-700'     },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700' },
};

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

function IconoBasura() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function ModalConfirmarEliminar({ orden, onCancelar, onConfirmar, loading }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <IconoBasura />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Eliminar orden</h3>
            <p className="text-sm text-gray-500 mt-1">
              ¿Eliminar la orden{' '}
              <span className="font-mono font-semibold text-gray-800">
                {orden.folio ?? `#${orden.id}`}
              </span>
              ? Esta acción no se puede deshacer.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancelar}
            disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Ordenes() {
  const { usuario }                           = useAuth();
  const navigate                              = useNavigate();
  const esAdmin                               = usuario?.rol === 'admin';

  const [ordenes,         setOrdenes]         = useState([]);
  const [filtro,          setFiltro]          = useState('TODOS');
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [ordenAEliminar,  setOrdenAEliminar]  = useState(null);
  const [loadingEliminar, setLoadingEliminar] = useState(false);
  const [errorEliminar,   setErrorEliminar]   = useState('');

  useEffect(() => {
    api.get('/ordenes')
      .then(setOrdenes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtradas = filtro === 'TODOS'
    ? ordenes
    : ordenes.filter(o => o.estado === filtro);

  async function confirmarEliminar() {
    if (!ordenAEliminar || loadingEliminar) return;
    setLoadingEliminar(true);
    setErrorEliminar('');
    try {
      await api.delete(`/ordenes/${ordenAEliminar.id}`);
      setOrdenes(prev => prev.filter(o => o.id !== ordenAEliminar.id));
      setOrdenAEliminar(null);
    } catch (err) {
      setErrorEliminar(err.message);
      setOrdenAEliminar(null);
    } finally {
      setLoadingEliminar(false);
    }
  }

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
            {e === 'TODOS' ? 'Todos' : BADGE_ESTADO[e]?.label}
          </button>
        ))}
      </div>

      {errorEliminar && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorEliminar}
        </div>
      )}

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
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tipo</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Pago</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Fecha</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtradas.map(o => {
                      const badgeEstado    = BADGE_ESTADO[o.estado]       ?? BADGE_ESTADO.ACTIVA;
                      const badgeModalidad = BADGE_MODALIDAD[o.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                      const badgePago      = BADGE_PAGO[o.estado_pago];
                      return (
                        <tr
                          key={o.id}
                          onClick={() => navigate(`/ordenes/${o.id}`)}
                          className="hover:bg-indigo-50 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            {o.folio ?? `#${o.id}`}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeModalidad.cls}`}>
                              {badgeModalidad.label}
                            </span>
                            {o.tamano && (
                              <span className="ml-1.5 text-xs text-gray-400 capitalize">{o.tamano}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">
                              {o.cliente_nombre ?? <span className="text-gray-400 italic">Anónimo</span>}
                            </p>
                            {o.cliente_telefono && (
                              <p className="text-xs text-gray-400">{o.cliente_telefono}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeEstado.cls}`}>
                              {badgeEstado.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {badgePago && (
                              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgePago.cls}`}>
                                {badgePago.label}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {fmtMonto(o.precio_total)}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {fmtFecha(o.created_at)}
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            {esAdmin && (
                              <button
                                onClick={() => setOrdenAEliminar(o)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Eliminar orden"
                              >
                                <IconoBasura />
                              </button>
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
                {filtradas.map(o => {
                  const badgeEstado    = BADGE_ESTADO[o.estado]       ?? BADGE_ESTADO.ACTIVA;
                  const badgeModalidad = BADGE_MODALIDAD[o.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                  const badgePago      = BADGE_PAGO[o.estado_pago];
                  return (
                    <div
                      key={o.id}
                      className="px-4 py-3 space-y-1.5 active:bg-gray-50 cursor-pointer"
                      onClick={() => navigate(`/ordenes/${o.id}`)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs text-gray-400">{o.folio ?? `#${o.id}`}</p>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeModalidad.cls}`}>
                            {badgeModalidad.label}
                            {o.tamano ? ` · ${o.tamano}` : ''}
                          </span>
                          {esAdmin && (
                            <button
                              onClick={e => { e.stopPropagation(); setOrdenAEliminar(o); }}
                              className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                              title="Eliminar orden"
                            >
                              <IconoBasura />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="font-medium text-gray-800 text-sm">
                        {o.cliente_nombre ?? <span className="text-gray-400 italic">Anónimo</span>}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeEstado.cls}`}>
                            {badgeEstado.label}
                          </span>
                          {badgePago && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgePago.cls}`}>
                              {badgePago.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {fmtFecha(o.created_at)}
                          {o.precio_total ? ` · ${fmtMonto(o.precio_total)}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal confirmar eliminación */}
      {ordenAEliminar && (
        <ModalConfirmarEliminar
          orden={ordenAEliminar}
          onCancelar={() => setOrdenAEliminar(null)}
          onConfirmar={confirmarEliminar}
          loading={loadingEliminar}
        />
      )}
    </div>
  );
}
