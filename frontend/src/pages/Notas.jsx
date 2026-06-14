import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';

const ESTADOS = ['TODOS', 'DEBE', 'EN_PROCESO', 'LISTA', 'ENTREGADA', 'CANCELADA'];

const FILTRO_LABEL = {
  TODOS: 'Todos',
  DEBE:  'Pagos Pendientes',
};

const BADGE_ESTADO = {
  EN_PROCESO: { label: 'En Proceso', cls: 'bg-blue-100 text-blue-800'       },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800' },
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

function fmtCliente(n) {
  if (!n.cliente_nombre) return null;
  const ap = (n.cliente_apellido ?? '').trim();
  return ap ? `${n.cliente_nombre} ${ap.charAt(0).toUpperCase()}.` : n.cliente_nombre;
}

function IconoBasura() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function ModalConfirmarEliminar({ nota, onCancelar, onConfirmar, loading }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <IconoBasura />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Eliminar nota</h3>
            <p className="text-sm text-gray-500 mt-1">
              ¿Eliminar la nota{' '}
              <span className="font-mono font-semibold text-gray-800">
                {nota.folio ?? `#${nota.id}`}
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

export default function Notas() {
  const { usuario }                           = useAuth();
  const navigate                              = useNavigate();
  const esAdmin                               = esAdminFn(usuario?.rol);

  const [notas,             setNotas]             = useState([]);
  const [filtro,            setFiltro]            = useState('TODOS');
  const [busqueda,          setBusqueda]          = useState('');
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [notaAEliminar,     setNotaAEliminar]     = useState(null);
  const [loadingEliminar,   setLoadingEliminar]   = useState(false);
  const [errorEliminar,     setErrorEliminar]     = useState('');

  useEffect(() => {
    api.get('/notas')
      .then(setNotas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const q = busqueda.trim().toLowerCase();
  const filtradas = notas.filter(n => {
    if (filtro === 'DEBE') {
      if (n.estado_pago !== 'DEBE') return false;
    } else if (filtro !== 'TODOS' && n.estado !== filtro) {
      return false;
    }
    if (!q) return true;
    const folio    = (n.folio ?? `#${n.id}`).toLowerCase();
    const cliente  = (n.cliente_nombre   ?? '').toLowerCase();
    const apellido = (n.cliente_apellido ?? '').toLowerCase();
    const telefono = (n.cliente_telefono ?? '').toLowerCase();
    return folio.includes(q) || cliente.includes(q) || apellido.includes(q) || telefono.includes(q);
  });

  async function confirmarEliminar() {
    if (!notaAEliminar || loadingEliminar) return;
    setLoadingEliminar(true);
    setErrorEliminar('');
    try {
      await api.delete(`/notas/${notaAEliminar.id}`);
      setNotas(prev => prev.filter(n => n.id !== notaAEliminar.id));
      setNotaAEliminar(null);
    } catch (err) {
      setErrorEliminar(err.message);
      setNotaAEliminar(null);
    } finally {
      setLoadingEliminar(false);
    }
  }

  return (
    <div className="pt-10 pb-16 px-6 md:py-14 md:px-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notas</h1>
          <p className="text-sm text-gray-500">{filtradas.length} resultado(s)</p>
        </div>
        <Link
          to="/notas/nueva"
          aria-label="Nueva nota"
          className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Buscar por folio, cliente o teléfono..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-11 pr-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition"
        />
      </div>

      {/* Filtros de estado */}
      <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-none">
        {ESTADOS.map(e => (
          <button
            key={e}
            onClick={() => setFiltro(e)}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === e
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'
            }`}
          >
            {FILTRO_LABEL[e] ?? BADGE_ESTADO[e]?.label}
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

      {!loading && !error && filtradas.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-12">
          <p className="text-gray-400 text-sm">
            {busqueda ? 'No se encontraron notas con ese criterio' : 'No hay notas con este filtro'}
          </p>
        </div>
      )}

      {!loading && !error && filtradas.length > 0 && (
        <>
          {/* Tabla — desktop */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
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
                    {filtradas.map(n => {
                      const badgeEstado    = BADGE_ESTADO[n.estado]       ?? BADGE_ESTADO.EN_PROCESO;
                      const badgeModalidad = BADGE_MODALIDAD[n.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                      const badgePago      = BADGE_PAGO[n.estado_pago];
                      return (
                        <tr
                          key={n.id}
                          onClick={() => navigate(`/notas/${n.id}`)}
                          className="hover:bg-indigo-50 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            #{n.folio?.split('-')[0] ?? n.id}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeModalidad.cls}`}>
                              {badgeModalidad.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">
                              {fmtCliente(n) ?? <span className="text-gray-400 italic">Anónimo</span>}
                            </p>
                            {n.cliente_telefono && (
                              <p className="text-xs text-gray-400">{n.cliente_telefono}</p>
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
                            {fmtMonto(n.precio_total)}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {fmtFecha(n.created_at)}
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            {esAdmin && (
                              <button
                                onClick={() => setNotaAEliminar(n)}
                                className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                title="Eliminar nota"
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
          </div>

          {/* Cards — mobile */}
          <div className="md:hidden space-y-3">
            {filtradas.map(n => {
              const badgeEstado    = BADGE_ESTADO[n.estado]       ?? BADGE_ESTADO.EN_PROCESO;
              const badgeModalidad = BADGE_MODALIDAD[n.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
              const badgePago      = BADGE_PAGO[n.estado_pago];
              return (
                <div
                  key={n.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 space-y-1.5 active:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/notas/${n.id}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs text-gray-400">#{n.folio?.split('-')[0] ?? n.id}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeModalidad.cls}`}>
                        {badgeModalidad.label}
                      </span>
                      {esAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); setNotaAEliminar(n); }}
                          className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors"
                          title="Eliminar nota"
                        >
                          <IconoBasura />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="font-medium text-gray-800 text-sm">
                    {fmtCliente(n) ?? <span className="text-gray-400 italic">Anónimo</span>}
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
                      {fmtFecha(n.created_at)}
                      {n.precio_total ? ` · ${fmtMonto(n.precio_total)}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal confirmar eliminación */}
      {notaAEliminar && (
        <ModalConfirmarEliminar
          nota={notaAEliminar}
          onCancelar={() => setNotaAEliminar(null)}
          onConfirmar={confirmarEliminar}
          loading={loadingEliminar}
        />
      )}
    </div>
  );
}
