import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ESTADOS = ['TODOS', 'RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];
const SECUENCIA_ESTADOS = ['RECIBIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];

const BADGE_ESTADO = {
  RECIBIDO:   { label: 'Recibido',   cls: 'bg-yellow-100 text-yellow-800' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-blue-100 text-blue-800' },
  LISTO:      { label: 'Listo',      cls: 'bg-green-100 text-green-800' },
  ENTREGADO:  { label: 'Entregado',  cls: 'bg-gray-100 text-gray-500' },
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

function siguienteEstado(estado) {
  const idx = SECUENCIA_ESTADOS.indexOf(estado);
  return idx < SECUENCIA_ESTADOS.length - 1 ? SECUENCIA_ESTADOS[idx + 1] : null;
}

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

// ── Ícono ojo ──────────────────────────────────────────────────
function IconoOjo() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

// ── Ícono basura ───────────────────────────────────────────────
function IconoBasura() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

// ── Modal de confirmación de eliminación ───────────────────────
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

// ── Stepper de estado ──────────────────────────────────────────
function StepperEstado({ estado }) {
  const idx = SECUENCIA_ESTADOS.indexOf(estado);
  return (
    <div className="flex items-center gap-0">
      {SECUENCIA_ESTADOS.map((s, i) => {
        const hecho   = i < idx;
        const actual  = i === idx;
        const futuro  = i > idx;
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                actual  ? 'border-indigo-600 bg-indigo-600 text-white' :
                hecho   ? 'border-indigo-300 bg-indigo-100 text-indigo-500' :
                          'border-gray-200 bg-white text-gray-300'
              }`}>
                {hecho ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span className={`text-[10px] font-medium leading-tight text-center w-14 ${
                actual ? 'text-indigo-700' : futuro ? 'text-gray-300' : 'text-indigo-400'
              }`}>
                {BADGE_ESTADO[s].label}
              </span>
            </div>
            {i < SECUENCIA_ESTADOS.length - 1 && (
              <div className={`h-0.5 w-4 mb-4 mx-0.5 ${i < idx ? 'bg-indigo-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Fila de detalle ────────────────────────────────────────────
function FilaDetalle({ label, children }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{children}</span>
    </div>
  );
}

// ── Drawer de detalle ──────────────────────────────────────────
function DrawerOrden({ orden, onClose, onEstadoChange, onPagoChange, loadingAccion, errorAccion }) {
  const badgeModalidad = BADGE_MODALIDAD[orden.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
  const badgePago      = BADGE_PAGO[orden.estado_pago];
  const siguiente      = siguienteEstado(orden.estado);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl flex flex-col">

        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="font-mono text-xs text-gray-400 mb-0.5">
              {orden.folio ?? `#${orden.id}`}
              <span className="ml-2 text-gray-300">·</span>
              <span className="ml-2 text-gray-400">ID {orden.id}</span>
            </p>
            <p className="text-sm font-bold text-gray-900">Detalle de orden</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Tipo */}
          <div>
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${badgeModalidad.cls}`}>
              {badgeModalidad.label}
              {orden.tamano && ` · ${orden.tamano}`}
            </span>
          </div>

          {/* Historial de estados */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Estado de la orden
            </p>
            <StepperEstado estado={orden.estado} />
          </div>

          {/* Datos de la orden */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Información
            </p>
            <div className="bg-gray-50 rounded-xl px-4">
              <FilaDetalle label="Cliente">
                {orden.cliente_nombre
                  ? <span>{orden.cliente_nombre}{orden.cliente_telefono ? <span className="text-gray-400 ml-1.5">{orden.cliente_telefono}</span> : null}</span>
                  : <span className="text-gray-400 italic">Anónimo</span>}
              </FilaDetalle>
              <FilaDetalle label="Máquina">
                {orden.maquina_nombre ?? <span className="text-gray-400">—</span>}
              </FilaDetalle>
              <FilaDetalle label="Descripción">
                {orden.descripcion ?? <span className="text-gray-400">—</span>}
              </FilaDetalle>
              <FilaDetalle label="Notas">
                {orden.notas ?? <span className="text-gray-400">—</span>}
              </FilaDetalle>
              <FilaDetalle label="Estado de pago">
                {badgePago
                  ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
                  : <span className="text-gray-400">—</span>}
              </FilaDetalle>
              <FilaDetalle label="Precio total">
                <span className="font-semibold">{fmtMonto(orden.precio_total)}</span>
              </FilaDetalle>
              <FilaDetalle label="Creada">
                {fmtFecha(orden.created_at)}
              </FilaDetalle>
            </div>
          </div>

          {/* Error de acción */}
          {errorAccion && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
              {errorAccion}
            </div>
          )}
        </div>

        {/* Acciones fijas al fondo */}
        <div className="border-t border-gray-100 p-4 space-y-2.5 flex-shrink-0">
          {siguiente && (
            <button
              onClick={onEstadoChange}
              disabled={loadingAccion}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              {loadingAccion ? 'Guardando...' : `Avanzar a ${BADGE_ESTADO[siguiente].label}`}
            </button>
          )}

          <button
            onClick={onPagoChange}
            disabled={loadingAccion}
            className={`w-full font-medium py-2.5 rounded-lg text-sm transition-colors border-2 disabled:opacity-60 ${
              orden.estado_pago === 'DEBE'
                ? 'border-green-500 text-green-700 hover:bg-green-50'
                : 'border-red-300 text-red-600 hover:bg-red-50'
            }`}
          >
            {orden.estado_pago === 'DEBE' ? 'Marcar como Pagado' : 'Marcar como Debe'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Página principal ───────────────────────────────────────────
export default function Ordenes() {
  const { usuario }                           = useAuth();
  const esAdmin                               = usuario?.rol === 'admin';

  const [ordenes,         setOrdenes]         = useState([]);
  const [filtro,          setFiltro]          = useState('TODOS');
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [ordenAbierta,    setOrdenAbierta]    = useState(null);
  const [loadingAccion,   setLoadingAccion]   = useState(false);
  const [errorAccion,     setErrorAccion]     = useState('');
  const [ordenAEliminar,  setOrdenAEliminar]  = useState(null);
  const [loadingEliminar, setLoadingEliminar] = useState(false);

  useEffect(() => {
    api.get('/ordenes')
      .then(setOrdenes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtradas = filtro === 'TODOS'
    ? ordenes
    : ordenes.filter(o => o.estado === filtro);

  function abrirOrden(o) {
    setOrdenAbierta(o);
    setErrorAccion('');
  }

  async function avanzarEstado() {
    if (!ordenAbierta || loadingAccion) return;
    const siguiente = siguienteEstado(ordenAbierta.estado);
    if (!siguiente) return;
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const res = await api.patch(`/ordenes/${ordenAbierta.id}/estado`, { estado: siguiente });
      const updated = { ...ordenAbierta, estado: res.estado };
      setOrdenAbierta(updated);
      setOrdenes(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  async function confirmarEliminar() {
    if (!ordenAEliminar || loadingEliminar) return;
    setLoadingEliminar(true);
    try {
      await api.delete(`/ordenes/${ordenAEliminar.id}`);
      setOrdenes(prev => prev.filter(o => o.id !== ordenAEliminar.id));
      setOrdenAEliminar(null);
      if (ordenAbierta?.id === ordenAEliminar.id) setOrdenAbierta(null);
    } catch (err) {
      setErrorAccion(err.message);
      setOrdenAEliminar(null);
    } finally {
      setLoadingEliminar(false);
    }
  }

  async function togglePago() {
    if (!ordenAbierta || loadingAccion) return;
    const nuevo = ordenAbierta.estado_pago === 'DEBE' ? 'PAGADO' : 'DEBE';
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const res = await api.patch(`/ordenes/${ordenAbierta.id}/estado-pago`, { estado_pago: nuevo });
      const updated = { ...ordenAbierta, estado_pago: res.estado_pago };
      setOrdenAbierta(updated);
      setOrdenes(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
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
                      const badgeEstado    = BADGE_ESTADO[o.estado]       ?? BADGE_ESTADO.RECIBIDO;
                      const badgeModalidad = BADGE_MODALIDAD[o.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                      const badgePago      = BADGE_PAGO[o.estado_pago];
                      return (
                        <tr key={o.id} className="hover:bg-gray-50 transition-colors">
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
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => abrirOrden(o)}
                                className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                                title="Ver detalle"
                              >
                                <IconoOjo />
                              </button>
                              {esAdmin && (
                                <button
                                  onClick={() => setOrdenAEliminar(o)}
                                  className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                  title="Eliminar orden"
                                >
                                  <IconoBasura />
                                </button>
                              )}
                            </div>
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
                  const badgeEstado    = BADGE_ESTADO[o.estado]       ?? BADGE_ESTADO.RECIBIDO;
                  const badgeModalidad = BADGE_MODALIDAD[o.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
                  const badgePago      = BADGE_PAGO[o.estado_pago];
                  return (
                    <div
                      key={o.id}
                      className="px-4 py-3 space-y-1.5 active:bg-gray-50 cursor-pointer"
                      onClick={() => abrirOrden(o)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs text-gray-400">{o.folio ?? `#${o.id}`}</p>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeModalidad.cls}`}>
                            {badgeModalidad.label}
                            {o.tamano ? ` · ${o.tamano}` : ''}
                          </span>
                          <IconoOjo />
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

      {/* Drawer de detalle */}
      {ordenAbierta && (
        <DrawerOrden
          orden={ordenAbierta}
          onClose={() => setOrdenAbierta(null)}
          onEstadoChange={avanzarEstado}
          onPagoChange={togglePago}
          loadingAccion={loadingAccion}
          errorAccion={errorAccion}
        />
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
