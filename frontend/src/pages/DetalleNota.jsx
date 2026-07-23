import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';

const BADGE_ESTADO = {
  EN_ESPERA:  { label: 'En Espera',   cls: 'bg-gray-100 text-gray-600'        },
  LAVANDO:    { label: 'Lavando',     cls: 'bg-blue-100 text-blue-800'        },
  SECANDO:    { label: 'Secando',     cls: 'bg-red-100 text-red-700'          },
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

const PRENDA_LABEL = {
  ROPA:    'Ropa',
  EDREDON: 'Edredón',
};

const BADGE_PAGO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-red-100 text-red-700'   },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700'  },
};

// Ciclo de vida de la nota completa. Los pasos "Lavando" y "Secando" se
// expanden con el avance Lavado/Secado de cada carga (ver desglose en el
// render), ya que con varias cargas cada una puede ir en una fase distinta.
const PASOS_ESTADO = [
  { key: 'EN_ESPERA',  label: 'En Espera',    fechaKey: 'EN_ESPERA'  },
  { key: 'LAVANDO',    label: 'Lavando',      fechaKey: 'LAVANDO'    },
  { key: 'SECANDO',    label: 'Secando',      fechaKey: 'SECANDO'    },
  { key: 'LISTA',      label: 'Por Entregar', fechaKey: 'LISTA'      },
  { key: 'FINALIZADA', label: 'Finalizada',   fechaKey: 'FINALIZADA' },
];

// Índice del paso ACTUAL (0..4) según el estado de la nota.
function progresoPasos(nota) {
  if (nota.estado === 'EN_ESPERA') return 0;
  if (nota.estado === 'LAVANDO') return 1;
  if (nota.estado === 'SECANDO') return 2;
  if (['LISTA', 'PAGADA'].includes(nota.estado)) return 3;
  if (nota.estado === 'FINALIZADA') return 4;
  return 0;
}

// Fase de una máquina dentro de su carga: en curso (asignada y EN USO), en
// espera (asignada pero sin iniciar), listo (ya se usó y liberó) o pendiente
// (nunca se asignó).
const FASE_ESTILO = {
  curso:     { label: 'En curso',  cls: 'text-blue-700',  dot: 'bg-blue-500 animate-pulse' },
  espera:    { label: 'En espera', cls: 'text-gray-500',  dot: 'bg-gray-400' },
  listo:     { label: 'Listo',     cls: 'text-green-700', dot: 'bg-green-500' },
  pendiente: { label: 'Pendiente', cls: 'text-gray-400',  dot: 'bg-gray-300' },
};

// `estado` es el de la máquina viva (en_uso / disponible). Una máquina asignada
// pero no iniciada está "en espera", no "en curso".
function faseMaquina(liveId, usadaId, estado) {
  if (liveId) return estado === 'en_uso' ? 'curso' : 'espera';
  if (usadaId) return 'listo';
  return 'pendiente';
}

function FaseChip({ label, fase }) {
  const s = FASE_ESTILO[fase];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${s.cls}`}>{s.label}</span>
    </span>
  );
}

function subtituloEstado(estado, { done, current }, fechaEstado) {
  if (fechaEstado) return fmtFechaHora(fechaEstado);
  if (done) return 'Completado';
  if (current) return 'Estado actual';
  return 'Pendiente';
}

const BADGE_MAQUINA_ESTADO = {
  // "disponible" aquí = máquina asignada a la carga pero sin iniciar (En espera): gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  // "terminado" = la máquina ya cumplió su parte y se desvinculó de la carga: verde.
  terminado:     { label: 'Terminó',       cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

// Abreviatura del tamaño para el desglose de cargas: Mediana → M, Jumbo → J,
// Edredón → E. Otros valores se muestran tal cual.
const TAMANO_ABBR = { Mediana: 'M', Jumbo: 'J', Edredón: 'E' };

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
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
  const badgeModal    = BADGE_MODALIDAD[nota.modalidad] ?? BADGE_MODALIDAD.AUTOSERVICIO;
  const badgePago     = BADGE_PAGO[nota.estado_pago];
  const barcodeValue  = nota.folio ?? String(nota.id);
  const pasoActual    = progresoPasos(nota);
  const fechaPorEstado = Object.fromEntries(
    (nota.historial_estados || []).map(h => [h.estado, h.created_at])
  );

  const totalProductos = (nota.productos || []).reduce(
    (s, p) => s + Number(p.subtotal), 0
  );

  return (
    <div className="min-h-full bg-slate-100">

      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-2xl mx-auto px-6 md:px-6 pt-10 md:pt-6 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/notas')}
            aria-label="Volver"
            className="flex-shrink-0 w-11 h-11 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 leading-tight truncate">
              Detalles Nota
            </h1>
            {/* <p className="text-xs text-gray-500">Nota #{nota.id}</p> */}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={enviarPorWhatsapp}
            disabled={!nota.cliente_telefono}
            aria-label="Enviar"
            title={nota.cliente_telefono ? 'Abrir WhatsApp con el ticket' : 'El cliente no tiene teléfono registrado'}
            className="w-11 h-11 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-opacity"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 19 19">
              <path d="M16.2312 2.76454C15.3557 1.88495 14.313 1.18752 13.164 0.712894C12.0149 0.238271 10.7823 -0.00405 9.53819 5.12002e-05C4.32513 5.12002e-05 0.0763821 4.22754 0.0763821 9.41453C0.0763821 11.077 0.515578 12.692 1.33668 14.117L0 19L5.01256 17.689C6.39698 18.4395 7.95327 18.8385 9.53819 18.8385C14.7513 18.8385 19 14.611 19 9.42403C19 6.90653 18.0166 4.54104 16.2312 2.76454ZM9.53819 17.2425C8.12512 17.2425 6.7407 16.8625 5.52814 16.15L5.24171 15.979L2.26281 16.758L3.05528 13.87L2.86432 13.5755C2.07907 12.3282 1.66219 10.8863 1.66131 9.41453C1.66131 5.10154 5.19397 1.58655 9.52864 1.58655C11.6291 1.58655 13.6055 2.40354 15.0854 3.88554C15.8183 4.61121 16.3991 5.47445 16.7941 6.4252C17.1891 7.37594 17.3904 8.39526 17.3864 9.42403C17.4055 13.737 13.8729 17.2425 9.53819 17.2425ZM13.8538 11.3905C13.6151 11.2765 12.4503 10.7065 12.2402 10.621C12.0206 10.545 11.8678 10.507 11.7055 10.735C11.5432 10.9725 11.0945 11.5045 10.9608 11.6565C10.8271 11.818 10.6839 11.837 10.4452 11.7135C10.2065 11.5995 9.44271 11.343 8.54523 10.545C7.83869 9.91803 7.37085 9.14853 7.22764 8.91103C7.09397 8.67353 7.20854 8.55003 7.33266 8.42653C7.43769 8.32203 7.57136 8.15103 7.68593 8.01803C7.8005 7.88503 7.84824 7.78053 7.92462 7.62853C8.001 7.46703 7.96281 7.33403 7.90553 7.22003C7.84824 7.10603 7.37085 5.94704 7.1799 5.47204C6.98894 5.01604 6.78844 5.07304 6.64523 5.06354H6.18693C6.02462 5.06354 5.77638 5.12054 5.55678 5.35804C5.34673 5.59554 4.73568 6.16554 4.73568 7.32453C4.73568 8.48353 5.58543 9.60453 5.7 9.75653C5.81457 9.91803 7.37085 12.293 9.73869 13.3095C10.302 13.5565 10.7412 13.699 11.0849 13.8035C11.6482 13.984 12.1638 13.9555 12.5744 13.8985C13.0327 13.832 13.9779 13.3285 14.1688 12.7775C14.3693 12.2265 14.3693 11.761 14.3025 11.6565C14.2357 11.552 14.0925 11.5045 13.8538 11.3905Z" fill="#27A910"/>
            </svg>
          </button>
        </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-2xl mx-auto px-6 md:p-6 py-6 space-y-6">

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
          {(nota.cargas ?? []).length === 0 && nota.tipo_prenda && PRENDA_LABEL[nota.tipo_prenda] && (
            <FilaDetalle label="Prenda">
              <span className="text-sm font-medium text-gray-800">{PRENDA_LABEL[nota.tipo_prenda]}</span>
            </FilaDetalle>
          )}
          {nota.tipo_tela && (
            <FilaDetalle label="Tela">
              <span className="text-sm font-medium text-gray-800">{nota.tipo_tela}</span>
            </FilaDetalle>
          )}
          {nota.tamano_edredon && (
            <FilaDetalle label="Tamaño del edredón">
              <span className="text-sm font-medium text-gray-800">{nota.tamano_edredon}</span>
            </FilaDetalle>
          )}
          <FilaDetalle label="Estado de pago">
            {badgePago
              ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
              : <span className="text-gray-400">—</span>}
          </FilaDetalle>
          {(nota.cargas ?? []).length > 0 ? (
            <FilaDetalle label="Cargas">
              <div className="space-y-3">
                {nota.cargas.map(cg => {
                  // Se muestran las máquinas USADAS (registro que persiste aunque
                  // el ciclo ya haya terminado y la máquina se liberara). El badge
                  // de estado en vivo solo aparece si la máquina sigue asignada a
                  // esta carga (lavadora_id / secadora_id presentes).
                  // Cada máquina muestra su costo real: la lavadora su
                  // precio_lavadora (lavado) y la secadora su precio_secadora
                  // (secado). Son cargos separados; no se reparte nada.
                  // Si la máquina sigue vinculada (lavadora_id/secadora_id), su
                  // estado en vivo (En espera / En uso); si ya se desvinculó,
                  // cumplió su parte → "terminado" (verde).
                  const maquinasCarga = [
                    cg.lavadora_usada_id && {
                      nombre: cg.lavadora_usada_nombre, tipo: cg.lavadora_usada_tipo,
                      estado: cg.lavadora_id ? cg.lavadora_estado : 'terminado',
                      precio: Number(cg.precio_lavadora),
                    },
                    cg.secadora_usada_id && {
                      nombre: cg.secadora_usada_nombre, tipo: cg.secadora_usada_tipo,
                      tamano: cg.secadora_usada_tamano,
                      estado: cg.secadora_id ? cg.secadora_estado : 'terminado',
                      precio: Number(cg.precio_secadora),
                    },
                  ].filter(Boolean);
                  const prods = cg.productos ?? [];
                  const totalProds = prods.reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
                  const totalCarga = Number(cg.precio_lavadora) + Number(cg.precio_secadora)
                    + Number(cg.ajuste ?? 0) + totalProds;
                  // Autoservicio no maneja prenda/tela/tamaño: se omite esa línea.
                  const atributos = nota.modalidad === 'AUTOSERVICIO' ? [] : [
                    PRENDA_LABEL[cg.tipo_prenda],
                    cg.tipo_tela,
                    cg.tamano_edredon,
                    cg.tamano ? cg.tamano.charAt(0).toUpperCase() + cg.tamano.slice(1) : null,
                  ].filter(Boolean);
                  return (
                    <div key={cg.id} className="border border-gray-100 rounded-lg p-3 space-y-1.5">
                      {/* Carga N en su propia línea; debajo, una línea por
                          máquina (lavadora y secadora) con su costo. */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500">Carga {cg.orden}</span>
                        <span className="text-sm font-medium text-gray-700">{fmtMonto(totalCarga)}</span>
                      </div>
                      {maquinasCarga.length === 0 ? (
                        <span className="text-sm text-gray-400 italic">Sin máquinas</span>
                      ) : (
                        maquinasCarga.map((m, i) => {
                          const cfg = BADGE_MAQUINA_ESTADO[m.estado];
                          // La secadora muestra su tamaño (Mediana/Jumbo) igual
                          // que la lavadora; sin tamaño cae a "Secadora". Se
                          // muestra abreviado (M/J/E).
                          const tamanoLabel = m.tipo === 'secadora' && m.tamano
                            ? m.tamano.charAt(0).toUpperCase() + m.tamano.slice(1)
                            : MAQUINA_TIPO_LABEL[m.tipo];
                          const tipoLabel = TAMANO_ABBR[tamanoLabel] ?? tamanoLabel;
                          return (
                            <div key={i} className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                                {/* Estado: solo el punto de color al inicio */}
                                {cfg && (
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`}
                                    title={cfg.label}
                                  />
                                )}
                                <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                                {tipoLabel && (
                                  <span className="text-xs text-gray-500">— {tipoLabel}</span>
                                )}
                              </div>
                              <span className="flex-shrink-0 text-sm text-gray-600">{fmtMonto(m.precio)}</span>
                            </div>
                          );
                        })
                      )}
                      {atributos.length > 0 && (
                        <p className="text-xs text-gray-500">{atributos.join(' · ')}</p>
                      )}
                      {prods.map(p => (
                        <p key={p.id} className="text-xs text-gray-500">
                          {p.nombre} · {p.cantidad} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}
                        </p>
                      ))}
                      {Number(cg.ajuste) !== 0 && (
                        <p className="text-xs text-gray-500">
                          Ajuste: {Number(cg.ajuste) > 0 ? '+' : ''}{fmtMonto(cg.ajuste)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </FilaDetalle>
          ) : (
            <>
              <FilaDetalle label={nota.secadora_nombre ? 'Lavadora' : 'Máquina'}>
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
              {nota.secadora_nombre && (
                <FilaDetalle label="Secadora">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{nota.secadora_nombre}</span>
                    {MAQUINA_TIPO_LABEL[nota.secadora_tipo] && (
                      <span className="text-xs text-gray-500">— {MAQUINA_TIPO_LABEL[nota.secadora_tipo]}</span>
                    )}
                    {(() => {
                      const cfg = BADGE_MAQUINA_ESTADO[nota.secadora_estado];
                      if (!cfg) return null;
                      return (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${nota.secadora_estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                          {cfg.label}
                        </span>
                      );
                    })()}
                  </div>
                </FilaDetalle>
              )}
            </>
          )}
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
          {/* Autoservicio no lleva instrucciones */}
          {nota.modalidad !== 'AUTOSERVICIO' && (
            <FilaDetalle label="Instrucciones">
              {nota.instrucciones ?? <span className="text-gray-400">—</span>}
            </FilaDetalle>
          )}
          <FilaDetalle label="Ajuste">
            {nota.ajuste != null ? fmtMonto(nota.ajuste) : '—'}
          </FilaDetalle>
          <FilaDetalle label="Precio total">
            <span className="font-semibold text-gray-900">{fmtMonto(nota.precio_total)}</span>
          </FilaDetalle>
        </div>
      </div>

      {/* Estado */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Estado</h2>
        </div>
        <div className="px-4 py-4">
          {nota.estado === 'CANCELADA' ? (
            <div className="flex gap-3 items-center">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-900">Cancelada</p>
                <p className="text-xs text-gray-400">Esta nota fue cancelada</p>
              </div>
            </div>
          ) : (
            <ol className="relative">
              {PASOS_ESTADO.map((paso, i) => {
                const done    = i < pasoActual;
                const current = i === pasoActual;
                const isLast  = i === PASOS_ESTADO.length - 1;
                // Cargas con su máquina EN USO en este paso. Se evalúa cada paso
                // por separado: una carga con lavadora y secadora corriendo a la
                // vez aparece bajo Lavando y bajo Secando.
                const cargasAqui =
                  paso.key === 'LAVANDO' ? (nota.cargas ?? []).filter(cg => cg.lavadora_id && cg.lavadora_estado === 'en_uso')
                  : paso.key === 'SECANDO' ? (nota.cargas ?? []).filter(cg => cg.secadora_id && cg.secadora_estado === 'en_uso')
                  : [];
                // Un paso se resalta si ya se pasó, es el actual de la nota, o
                // tiene alguna carga viviéndolo (p. ej. Secando con una carga
                // adelantada mientras otra sigue en Lavando).
                const activo  = done || current || cargasAqui.length > 0;
                return (
                  <li key={paso.key} className="relative flex gap-3 pb-6 last:pb-0">
                    {!isLast && (
                      <span
                        className={`absolute left-[11px] top-6 -bottom-0 w-px border-l-2 border-dashed ${
                          done || cargasAqui.length > 0 ? 'border-blue-600' : 'border-gray-200'
                        }`}
                      />
                    )}
                    <span
                      className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                        activo ? 'bg-blue-600 text-white' : 'bg-white border-2 border-gray-300'
                      }`}
                    >
                      {done ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (current || cargasAqui.length > 0) ? (
                        <span className="w-2 h-2 rounded-full bg-white" />
                      ) : null}
                    </span>
                    <div className="-mt-0.5 pb-0.5 min-w-0">
                      <p className={`text-sm font-semibold ${activo ? 'text-gray-900' : 'text-gray-400'}`}>
                        {paso.label}
                      </p>
                      <p className="text-xs text-gray-400">{subtituloEstado(paso.key, { done, current }, paso.fechaKey ? fechaPorEstado[paso.fechaKey] : undefined)}</p>

                      {/* Desglose de las cargas que viven este paso: cada una
                          con el avance de ESE paso (Lavado bajo Lavando, Secado
                          bajo Secando), no ambos. */}
                      {cargasAqui.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {cargasAqui.map(cg => (
                            <div key={cg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                              <span className="font-semibold text-gray-500">Carga {cg.orden}</span>
                              {paso.key === 'LAVANDO' ? (
                                <FaseChip label="Lavado" fase={faseMaquina(cg.lavadora_id, cg.lavadora_usada_id, cg.lavadora_estado)} />
                              ) : (
                                <FaseChip label="Secado" fase={faseMaquina(cg.secadora_id, cg.secadora_usada_id, cg.secadora_estado)} />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
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
