import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const BADGE_ESTADO = {
  ACTIVA:     { label: 'Activa',      cls: 'bg-gray-100 text-gray-700'        },
  EN_PROCESO: { label: 'En proceso',  cls: 'bg-blue-100 text-blue-800'        },
  LISTA:      { label: 'Lista',       cls: 'bg-yellow-100 text-yellow-800'    },
  PAGADA:     { label: 'Pagada',      cls: 'bg-emerald-100 text-emerald-800'  },
  ENTREGADA:  { label: 'Entregada',   cls: 'bg-green-800 text-white'          },
  CANCELADA:  { label: 'Cancelada',   cls: 'bg-red-100 text-red-700'          },
};

const BADGE_MODALIDAD = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-purple-100 text-purple-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por encargo',  cls: 'bg-amber-100 text-amber-700'   },
};

const BADGE_PAGO = {
  DEBE:   { label: 'Debe',   cls: 'bg-red-100 text-red-700'      },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700'  },
};

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function FilaDetalle({ label, children }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{children}</span>
    </div>
  );
}

function ModalConfirmar({ titulo, mensaje, onCancelar, onConfirmar, loading, colorBtn = 'bg-red-600 hover:bg-red-700' }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold text-gray-900">{titulo}</h3>
        <p className="text-sm text-gray-500">{mensaje}</p>
        <div className="flex gap-3">
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
            className={`flex-1 ${colorBtn} text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60`}
          >
            {loading ? 'Procesando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DetalleOrden() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [orden,          setOrden]          = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [loadingAccion,  setLoadingAccion]  = useState(false);
  const [errorAccion,    setErrorAccion]    = useState('');
  const [confirmCancelar, setConfirmCancelar] = useState(false);

  useEffect(() => { cargarOrden(); }, [id]);

  async function cargarOrden() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/ordenes/${id}`);
      setOrden(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelarOrden() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/ordenes/${id}/estado`, { estado: 'CANCELADA' });
      setOrden(prev => ({ ...prev, estado: updated.estado }));
      setConfirmCancelar(false);
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmCancelar(false);
    } finally {
      setLoadingAccion(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>
      </div>
    );
  }

  if (!orden) return null;

  const terminal     = ['ENTREGADA', 'CANCELADA'].includes(orden.estado);
  const puedeEditar  = !['PAGADA', 'ENTREGADA', 'CANCELADA'].includes(orden.estado);
  const puedeCancelar = !['CANCELADA'].includes(orden.estado);
  const badgeEstado   = BADGE_ESTADO[orden.estado]       ?? BADGE_ESTADO.ACTIVA;
  const badgeModal    = BADGE_MODALIDAD[orden.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
  const badgePago     = BADGE_PAGO[orden.estado_pago];
  const barcodeValue  = orden.folio ?? String(orden.id);

  const totalArticulos = (orden.articulos || []).reduce(
    (s, a) => s + Number(a.subtotal), 0
  );

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Cabecera */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/ordenes')}
            className="text-sm text-indigo-600 hover:underline mb-1 flex items-center gap-1"
          >
            ← Órdenes
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {orden.folio ?? `Orden #${orden.id}`}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">ID {orden.id} · {fmtFecha(orden.created_at)}</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 ${badgeEstado.cls}`}>
          {badgeEstado.label}
        </span>
      </div>

      {/* Error de acción */}
      {errorAccion && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorAccion}
        </div>
      )}

      {/* Botones de acción */}
      {!terminal && (
        <div className="flex flex-wrap gap-2">
          {puedeEditar && (
            <button
              onClick={() => navigate(`/ordenes/${id}/editar`)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Editar orden
            </button>
          )}
          <button
            onClick={() => navigate(`/ordenes/${id}/salidas`)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Salidas
          </button>
          {puedeCancelar && (
            <button
              onClick={() => setConfirmCancelar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Cancelar orden
            </button>
          )}
          <button
            disabled
            title="Disponible en Fase 6"
            className="flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-400 text-sm font-medium rounded-lg cursor-not-allowed"
          >
            Imprimir
          </button>
        </div>
      )}
      {terminal && (
        <button
          disabled
          title="Disponible en Fase 6"
          className="flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-400 text-sm font-medium rounded-lg cursor-not-allowed"
        >
          Imprimir
        </button>
      )}

      {/* Código de barras */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex justify-center shadow-sm">
        <Barcode value={barcodeValue} height={50} fontSize={12} />
      </div>

      {/* Información de la orden */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Información</h2>
        </div>
        <div className="px-4">
          <FilaDetalle label="Tipo">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeModal.cls}`}>
              {badgeModal.label}
            </span>
            {orden.tamano && <span className="ml-2 text-xs text-gray-500 capitalize">{orden.tamano}</span>}
          </FilaDetalle>
          <FilaDetalle label="Estado">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeEstado.cls}`}>
              {badgeEstado.label}
            </span>
          </FilaDetalle>
          <FilaDetalle label="Estado de pago">
            {badgePago
              ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
              : <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Máquina">
            {orden.maquina_nombre ?? <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Cliente">
            {orden.cliente_nombre
              ? <>{orden.cliente_nombre}{orden.cliente_telefono && <span className="text-gray-400 ml-2">{orden.cliente_telefono}</span>}</>
              : <span className="text-gray-400 italic">Anónimo</span>}
          </FilaDetalle>
          <FilaDetalle label="Descripción">
            {orden.descripcion ?? <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Notas">
            {orden.notas ?? <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Ajuste">
            {orden.ajuste != null ? fmtMonto(orden.ajuste) : '—'}
          </FilaDetalle>
          <FilaDetalle label="Precio total">
            <span className="font-semibold text-gray-900">{fmtMonto(orden.precio_total)}</span>
          </FilaDetalle>
          <FilaDetalle label="Creada">
            {fmtFecha(orden.created_at)}
          </FilaDetalle>
        </div>
      </div>

      {/* Artículos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Artículos</h2>
          {(orden.articulos || []).length > 0 && (
            <span className="text-xs text-gray-400">{(orden.articulos || []).length} ítem(s)</span>
          )}
        </div>
        {(orden.articulos || []).length === 0 ? (
          <p className="text-sm text-gray-400 italic px-4 py-4">Sin artículos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {(orden.articulos || []).map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{a.nombre}</p>
                  <p className="text-xs text-gray-400">Cant. {a.cantidad} × {fmtMonto(a.precio_unitario)}</p>
                </div>
                <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                  {fmtMonto(a.subtotal)}
                </span>
              </div>
            ))}
            <div className="px-4 py-3 flex justify-between bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">Total artículos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalArticulos)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmar cancelación */}
      {confirmCancelar && (
        <ModalConfirmar
          titulo="Cancelar orden"
          mensaje={`¿Cancelar la orden ${orden.folio ?? `#${orden.id}`}? Esta acción liberará el stock reservado y no se puede deshacer.`}
          onCancelar={() => setConfirmCancelar(false)}
          onConfirmar={cancelarOrden}
          loading={loadingAccion}
          colorBtn="bg-orange-500 hover:bg-orange-600"
        />
      )}
    </div>
  );
}
