import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';

const BADGE_ESTADO = {
  EN_PROCESO: { label: 'En Proceso',  cls: 'bg-blue-100 text-blue-800'        },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800'   },
  PAGADA:     { label: 'Pagada',      cls: 'bg-emerald-100 text-emerald-800'  },
  FINALIZADA: { label: 'Finalizada', cls: 'bg-green-800 text-white'          },
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

const ESTADO_ORDEN = ['EN_PROCESO', 'LISTA', 'PAGADA', 'FINALIZADA'];

function estadosPasados(estadoActual) {
  const idx = ESTADO_ORDEN.indexOf(estadoActual);
  if (idx <= 0) return [];
  return ESTADO_ORDEN.slice(0, idx);
}

const BADGE_MAQUINA_ESTADO = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
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

export default function DetalleNota() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);

  const [nota,             setNota]             = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingAccion,    setLoadingAccion]    = useState(false);
  const [errorAccion,      setErrorAccion]      = useState('');
  const [confirmCancelar,  setConfirmCancelar]  = useState(false);
  const [confirmFinalizar,  setConfirmFinalizar]  = useState(false);
  const [confirmEliminar,  setConfirmEliminar]  = useState(false);

  useEffect(() => {
    let activo = true;
    api.get(`/notas/${id}`)
      .then(data => { if (activo) setNota(data); })
      .catch(err => { if (activo) setError(err.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

  async function cancelarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/estado`, { estado: 'CANCELADA' });
      setNota(prev => ({ ...prev, estado: updated.estado }));
      setConfirmCancelar(false);
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmCancelar(false);
    } finally {
      setLoadingAccion(false);
    }
  }

  function enviarPorWhatsapp() {
    if (!nota?.cliente_telefono) return;
    const digits = String(nota.cliente_telefono).replace(/\D/g, '');
    if (digits.length === 0) return;
    const phone = digits.startsWith('52') ? digits : `52${digits}`;

    const lineas = [
      '*Lavandería El Sol*',
      `Nota: ${nota.folio ?? `#${nota.id}`}`,
    ];
    if (nota.cliente_nombre) {
      const apellido = nota.cliente_apellido ? ` ${nota.cliente_apellido}` : '';
      lineas.push(`Cliente: ${nota.cliente_nombre}${apellido}`);
    }
    if (nota.precio_total != null) {
      lineas.push(`Total: ${fmtMonto(nota.precio_total)}`);
    }
    lineas.push(`Estado: ${BADGE_ESTADO[nota.estado]?.label ?? nota.estado}`);
    if (nota.estado_pago && BADGE_PAGO[nota.estado_pago]) {
      lineas.push(`Pago: ${BADGE_PAGO[nota.estado_pago].label}`);
    }
    if (nota.fecha_entrega) {
      lineas.push(`Entrega: ${fmtFecha(nota.fecha_entrega)}`);
    }
    lineas.push('', '¡Gracias por su preferencia!');

    const texto = encodeURIComponent(lineas.join('\n'));
    window.open(`https://wa.me/${phone}?text=${texto}`, '_blank', 'noopener,noreferrer');
  }

  async function eliminarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}`);
      navigate('/notas');
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmEliminar(false);
    } finally {
      setLoadingAccion(false);
    }
  }

  async function finalizarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/estado`, { estado: 'FINALIZADA' });
      setNota(prev => ({ ...prev, estado: updated.estado }));
      setConfirmFinalizar(false);
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmFinalizar(false);
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

  if (!nota) return null;

  const terminal     = ['FINALIZADA', 'CANCELADA'].includes(nota.estado);
  const puedeEditar  = !['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(nota.estado);
  const puedeCancelar = !['CANCELADA'].includes(nota.estado);
  const badgeEstado   = BADGE_ESTADO[nota.estado]       ?? BADGE_ESTADO.EN_PROCESO;
  const badgeModal    = BADGE_MODALIDAD[nota.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
  const badgePago     = BADGE_PAGO[nota.estado_pago];
  const barcodeValue  = nota.folio ?? String(nota.id);

  const totalProductos = (nota.productos || []).reduce(
    (s, p) => s + Number(p.subtotal), 0
  );

  return (
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Cabecera */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/notas')}
            aria-label="Volver"
            className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 leading-tight truncate">
              {nota.folio ?? `Nota #${nota.id}`}
            </h1>
            <p className="text-xs text-gray-500">ID {nota.id} · {fmtFecha(nota.created_at)}</p>
          </div>
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
              onClick={() => navigate(`/notas/${id}/editar`)}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Editar nota
            </button>
          )}
          <button
            onClick={() => navigate(`/notas/${id}/salidas`)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Salidas
          </button>
          <button
            onClick={enviarPorWhatsapp}
            disabled={!nota.cliente_telefono}
            title={nota.cliente_telefono ? 'Abrir WhatsApp con el ticket' : 'El cliente no tiene teléfono registrado'}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            Enviar
          </button>
          {nota.estado === 'LISTA' && (
            <button
              onClick={() => setConfirmFinalizar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Finalizar
            </button>
          )}
          {puedeCancelar && (
            <button
              onClick={() => setConfirmCancelar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Cancelar nota
            </button>
          )}
          <button
            disabled
            title="Disponible en Fase 6"
            className="flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-400 text-sm font-medium rounded-lg cursor-not-allowed"
          >
            Imprimir
          </button>
          {esAdmin && (
            <button
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Eliminar
            </button>
          )}
        </div>
      )}
      {terminal && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={enviarPorWhatsapp}
            disabled={!nota.cliente_telefono}
            title={nota.cliente_telefono ? 'Abrir WhatsApp con el ticket' : 'El cliente no tiene teléfono registrado'}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            Enviar
          </button>
          <button
            disabled
            title="Disponible en Fase 6"
            className="flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-400 text-sm font-medium rounded-lg cursor-not-allowed"
          >
            Imprimir
          </button>
          {esAdmin && (
            <button
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Eliminar
            </button>
          )}
        </div>
      )}

      {/* Código de barras */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex justify-center shadow-sm">
        <Barcode value={barcodeValue} height={50} fontSize={12} />
      </div>

      {/* Información de la nota */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Información</h2>
        </div>
        <div className="px-4">
          <FilaDetalle label="Tipo">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeModal.cls}`}>
              {badgeModal.label}
            </span>
            {nota.tamano && <span className="ml-2 text-xs text-gray-500 capitalize">{nota.tamano}</span>}
          </FilaDetalle>
          <FilaDetalle label="Estado">
            <div className="flex items-center flex-wrap gap-1.5">
              {estadosPasados(nota.estado).map(e => {
                const cfg = BADGE_ESTADO[e];
                if (!cfg) return null;
                return (
                  <span
                    key={e}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-400 line-through"
                  >
                    {cfg.label}
                  </span>
                );
              })}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeEstado.cls}`}>
                {badgeEstado.label}
              </span>
            </div>
          </FilaDetalle>
          <FilaDetalle label="Estado de pago">
            {badgePago
              ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
              : <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Máquina">
            {nota.maquina_nombre ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-800">{nota.maquina_nombre}</span>
                {MAQUINA_TIPO_LABEL[nota.maquina_tipo] && (
                  <span className="text-xs text-gray-500">— {MAQUINA_TIPO_LABEL[nota.maquina_tipo]}</span>
                )}
                {(() => {
                  const cfg = BADGE_MAQUINA_ESTADO[nota.maquina_estado];
                  if (!cfg) return null;
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${nota.maquina_estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                      {cfg.label}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </FilaDetalle>
          <FilaDetalle label="Cliente">
            {nota.cliente_nombre
              ? (
                  <div>
                    <p>{`${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`}</p>
                    {nota.cliente_telefono && (
                      <p className="text-gray-400 text-sm">{nota.cliente_telefono}</p>
                    )}
                  </div>
                )
              : <span className="text-gray-400 italic">Anónimo</span>}
          </FilaDetalle>
          <FilaDetalle label="Instrucciones">
            {nota.instrucciones ?? <span className="text-gray-400">—</span>}
          </FilaDetalle>
          <FilaDetalle label="Ajuste">
            {nota.ajuste != null ? fmtMonto(nota.ajuste) : '—'}
          </FilaDetalle>
          <FilaDetalle label="Precio total">
            <span className="font-semibold text-gray-900">{fmtMonto(nota.precio_total)}</span>
          </FilaDetalle>
          <FilaDetalle label="Creada">
            {fmtFecha(nota.created_at)}
          </FilaDetalle>
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
          {(nota.productos || []).length > 0 && (
            <span className="text-xs text-gray-400">{(nota.productos || []).length} ítem(s)</span>
          )}
        </div>
        {(nota.productos || []).length === 0 ? (
          <p className="text-sm text-gray-400 italic px-4 py-4">Sin productos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {(nota.productos || []).map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
                  <p className="text-xs text-gray-400">Cant. {p.cantidad} × {fmtMonto(p.precio_unitario)}</p>
                </div>
                <span className="text-sm font-semibold text-gray-700 flex-shrink-0">
                  {fmtMonto(p.subtotal)}
                </span>
              </div>
            ))}
            <div className="px-4 py-3 flex justify-between bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">Total productos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalProductos)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmar cancelación */}
      {confirmCancelar && (
        <ModalConfirmar
          titulo="Cancelar nota"
          mensaje={`¿Cancelar la nota ${nota.folio ?? `#${nota.id}`}? Esta acción liberará el stock reservado y no se puede deshacer.`}
          onCancelar={() => setConfirmCancelar(false)}
          onConfirmar={cancelarNota}
          loading={loadingAccion}
          colorBtn="bg-orange-500 hover:bg-orange-600"
        />
      )}

      {/* Modal confirmar entrega */}
      {confirmFinalizar && (
        <ModalConfirmar
          titulo="Finalizar nota"
          mensaje={`¿Marcar la nota ${nota.folio ?? `#${nota.id}`} como finalizada? Esta acción no se puede deshacer.`}
          onCancelar={() => setConfirmFinalizar(false)}
          onConfirmar={finalizarNota}
          loading={loadingAccion}
          colorBtn="bg-emerald-600 hover:bg-emerald-700"
        />
      )}

      {/* Modal confirmar eliminación */}
      {confirmEliminar && (
        <ModalConfirmar
          titulo="Eliminar nota"
          mensaje={`¿Eliminar la nota ${nota.folio ?? `#${nota.id}`}? Esta acción liberará el stock reservado y no se puede deshacer.`}
          onCancelar={() => setConfirmEliminar(false)}
          onConfirmar={eliminarNota}
          loading={loadingAccion}
        />
      )}
    </div>
  );
}
