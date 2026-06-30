import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';

const BADGE_ESTADO = {
  EN_ESPERA:  { label: 'En Espera',   cls: 'bg-gray-100 text-gray-600'        },
  EN_PROCESO: { label: 'En Proceso',  cls: 'bg-blue-100 text-blue-800'        },
  POR_PROCESAR: { label: 'Por Procesar', cls: 'bg-purple-100 text-purple-700' },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800'   },
  PAGADA:     { label: 'Pagada',      cls: 'bg-emerald-100 text-emerald-800'  },
  FINALIZADA: { label: 'Finalizada', cls: 'bg-green-800 text-white'          },
  CANCELADA:  { label: 'Cancelada',   cls: 'bg-red-100 text-red-700'          },
};

const BADGE_MODALIDAD = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-light-blue text-blue-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por encargo',  cls: 'bg-amber-100 text-amber-700'   },
};

const BADGE_PAGO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-red-100 text-red-700'   },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700'  },
};

const ESTADO_ORDEN = ['EN_ESPERA', 'EN_PROCESO', 'POR_PROCESAR', 'LISTA', 'PAGADA', 'FINALIZADA'];

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
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={loading}
            className={`flex-1 ${colorBtn} text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60`}
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
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
              Detalles
            </h1>
            <p className="text-xs text-gray-500">Nota #{nota.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={enviarPorWhatsapp}
            disabled={!nota.cliente_telefono}
            aria-label="Enviar"
            title={nota.cliente_telefono ? 'Abrir WhatsApp con el ticket' : 'El cliente no tiene teléfono registrado'}
            className="w-11 h-11 text-green-600 hover:text-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.207zm5.392-.823c4.531 0 8.205-3.674 8.205-8.205 0-4.531-3.674-8.205-8.205-8.205-4.531 0-8.205 3.674-8.205 8.205 0 4.531 3.674 8.205 8.205 8.205zm4.94-6.135c-.075-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
          </button>
          <button
            disabled
            aria-label="Imprimir"
            title="Disponible en Fase 6"
            className="w-11 h-11 text-gray-400 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" />
            </svg>
          </button>
        </div>
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
          <FilaDetalle label="ID">
            <span className="text-sm font-medium text-gray-800">{nota.id}</span>
          </FilaDetalle>
          <FilaDetalle label="# Nota">
            <span className="text-sm font-medium text-gray-800">{nota.folio ?? `#${nota.id}`}</span>
          </FilaDetalle>
          <FilaDetalle label="Creada">
            {fmtFecha(nota.created_at)}
          </FilaDetalle>
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
