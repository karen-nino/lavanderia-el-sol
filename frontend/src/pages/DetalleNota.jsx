import { useEffect, useState } from 'react';
import { etiquetaEstadoNota } from '../lib/estadoNota';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { urlListaNotas } from '../lib/filtrosNotas';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn, esAdminMain as esAdminMainFn } from '../lib/roles';
import { etiquetaProducto, tituloProducto, subtituloProducto, ordenProducto, seVendePorUnidad } from '../lib/formatoInventario';
import { FORMAS_PAGO, formaPagoLabel } from '../lib/formasPago';
import { formatHora12, formatFechaHora12 } from '../lib/fecha';
import { leerAvisoCobro, limpiarAvisoCobro } from '../lib/avisoCobro';
import { esTerminal, puedeLiquidar, puedeFinalizar, puedeEliminar } from '../lib/accionesNota';
import AbrirCajaModal from '../components/AbrirCajaModal';
import ModalCobrar from '../components/ModalCobrar';
import { ES_DEMO } from '../lib/entorno';
import { armarMensajeWhatsapp, hayMensajeWhatsapp, telefonoWhatsapp } from '../lib/mensajeWhatsapp';

/** Unidad de un producto de la nota en texto ("2 botellas", "3 medidas"). */
function unidadProdTxt(p) {
  const n = Number(p.cantidad);
  if (p.unidad === 'pieza') return n === 1 ? 'pieza' : 'piezas';
  if (p.unidad === 'botella') {
    // Marca y polvo, por pieza; el granel líquido, por botella.
    if (seVendePorUnidad(p)) return n === 1 ? 'pieza' : 'piezas';
    return n === 1 ? 'botella' : 'botellas';
  }
  return n === 1 ? 'medida' : 'medidas';
}
const BADGE_TIPO_SERVICIO = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-light-blue text-blue-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por encargo',  cls: 'bg-amber-100 text-amber-700'   },
  PRODUCTOS:    { label: 'Productos',    cls: 'bg-violet-100 text-violet-700'  },
};

const PRENDA_LABEL = {
  ROPA:    'Ropa',
  EDREDON: 'Edredón',
};

/** Día prometido al cliente. Valores viejos (mañana/tarde/noche) se muestran tal cual. */
const TIEMPO_ENTREGA_LABEL = {
  MANANA:   'Mañana',
  DOS_DIAS: 'En 2 días',
  // "Otra" no se muestra: su fecha va en la fila de abajo.
  OTRA:     'Otra fecha',
};

const BADGE_PAGO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-red-100 text-red-700'   },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700'  },
};

/** Código de barras del folio: apagado; el bloque se conserva. */
const MOSTRAR_CODIGO_BARRAS = false;

/**
 * Línea de tiempo de la nota: oculta. LAVANDO y SECANDO forman un solo paso,
 * "En proceso" (las cargas corren por separado). `estados` son los de la nota
 * que caen en el paso; su fecha es la primera de ellos.
 */
const MOSTRAR_ESTADO_NOTA = false;

const PASOS_ESTADO = [
  { key: 'EN_ESPERA',  label: 'En Espera',    estados: ['EN_ESPERA'] },
  { key: 'PROCESO',    label: 'En proceso',   estados: ['LAVANDO', 'SECANDO'] },
  // El label de LISTA lo pone etiquetaEstadoLista() (en Autoservicio, "Por Cobrar").
  { key: 'LISTA',      label: 'Por Entregar', estados: ['LISTA'] },
  { key: 'FINALIZADA', label: 'Finalizada',   estados: ['FINALIZADA'] },
];

/**
 * Pasos de esta nota. El Autoservicio pagado se finaliza solo y no pasa por
 * "Por Entregar"; el que debe sí, esperando su cobro.
 */
function pasosDeNota(nota) {
  // La venta de productos nace finalizada: un solo paso.
  if (nota.tipo_servicio === 'PRODUCTOS') return PASOS_ESTADO.filter(p => p.key === 'FINALIZADA');
  if (nota.tipo_servicio !== 'AUTOSERVICIO') return PASOS_ESTADO;
  const porEntregar = ['LISTA', 'PAGADA'].includes(nota.estado)
    || (nota.historial_estados ?? []).some(h => h.estado === 'LISTA')
    // El que debe pasará por ahí, aunque aún no llegue.
    || nota.estado_pago === 'PENDIENTE';
  // Lavado y secado solo si la nota los va a vivir: una máquina puesta, usada o
  // pedida, o si ya pasó por esa fase.
  const tieneFase = (estado, campos) =>
    nota.estado === estado
    || (nota.historial_estados ?? []).some(h => h.estado === estado)
    || (nota.cargas ?? []).some(cg => campos.some(c => cg[c]));
  const conLavado = tieneFase('LAVANDO', ['lavadora_id', 'lavadora_usada_id', 'lavadora_tipo_previsto']);
  const conSecado = tieneFase('SECANDO', ['secadora_id', 'secadora_usada_id', 'secadora_tipo_previsto']);
  const fuera = new Set();
  if (!porEntregar) fuera.add('LISTA');
  // Sobra solo si la nota no lava ni seca.
  if (!conLavado && !conSecado) fuera.add('PROCESO');
  return PASOS_ESTADO.filter(p => !fuera.has(p.key));
}

/** Índice del paso actual: se busca por la lista de estados de cada paso. */
function progresoPasos(nota, pasos) {
  const clave = nota.estado === 'PAGADA' ? 'LISTA' : nota.estado;
  const i = pasos.findIndex(p => p.estados.includes(clave));
  return i === -1 ? 0 : i;
}

/** Cuándo empezó el paso: la primera fecha de los estados que agrupa. */
function fechaDePaso(paso, fechaPorEstado) {
  const fechas = paso.estados.map(e => fechaPorEstado[e]).filter(Boolean);
  return fechas.length > 0 ? fechas.sort()[0] : undefined;
}

/**
 * Fase de una máquina en su carga: en curso (en uso), en espera (asignada sin
 * iniciar), listo (ya se usó) o pendiente (sin asignar).
 */
const FASE_ESTILO = {
  curso:     { label: 'En curso',  cls: 'text-blue-700',  dot: 'bg-blue-500 animate-pulse' },
  espera:    { label: 'En espera', cls: 'text-gray-500',  dot: 'bg-gray-400' },
  listo:     { label: 'Listo',     cls: 'text-green-700', dot: 'bg-green-500' },
  pendiente: { label: 'Pendiente', cls: 'text-gray-400',  dot: 'bg-gray-300' },
};

/** `estado` es el de la máquina viva: asignada sin iniciar = en espera. */
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
  // Asignada a la carga pero sin iniciar: gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  // Ya cumplió su parte y se soltó de la carga: verde.
  terminado:     { label: 'Terminó',       cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

/** Abreviatura del tamaño para el desglose de cargas (M, J, E). */
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
  return formatFechaHora12(iso);
}

function fmtHora(iso) {
  if (!iso) return '—';
  return formatHora12(iso);
}

function FilaDetalle({ label, children }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-400 w-32 flex-shrink-0 pt-0.5">{label}</span>
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

/**
 * Acción en redondo: círculo de color con su ícono y la palabra debajo. Toda el
 * área (círculo y palabra) se puede tocar.
 */
function AccionCircular({ icono, label, onClick, color, disabled = false, title, className = 'flex' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // `className` decide cómo se muestra (Eliminar se esconde en táctil), por eso
      // el `flex` va ahí.
      className={`${className} flex-col items-center gap-1.5 w-20 disabled:opacity-60 disabled:cursor-not-allowed group`}
    >
      <span className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors ${color}`}>
        {icono}
      </span>
      {/* Mayúsculas espaciadas: se lee como rótulo del ícono. */}
      <span className="text-[12px] font-bold uppercase tracking-wider text-gray-700 text-center leading-tight">
        {label}
      </span>
    </button>
  );
}

// En true los empleados también ven Cancelar (se usó en capacitaciones); va junto con notas.controller.js.
const EMPLEADOS_CANCELAN = false;

// Íconos de las acciones, en trazo blanco sobre el círculo.
const IconoSalidas = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Puerta con una flecha que sale: la ropa que deja la lavandería. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

const IconoCobrar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Billete con su moneda en medio. */}
    <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={2} />
    <circle cx="12" cy="12" r="2.5" strokeWidth={2} />
    <path strokeLinecap="round" strokeWidth={2} d="M6 12h.01M18 12h.01" />
  </svg>
);

const IconoAjuste = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Más y menos: descuento o cargo extra sobre el total. */}
    <path strokeLinecap="round" strokeWidth={2} d="M12 4v8M8 8h8M8 18h8" />
  </svg>
);

const IconoCancelar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Círculo tachado: la nota se anula. */}
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <path strokeLinecap="round" strokeWidth={2} d="M5.6 5.6l12.8 12.8" />
  </svg>
);

const IconoProcesado = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Pulgar arriba: la ropa ya quedó lista. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
  </svg>
);

const IconoAvisar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Avión de papel: el aviso que se le manda al cliente. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M21 3L10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3z" />
  </svg>
);

const IconoEntregar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Palomita en círculo: el último paso, la ropa se fue con su dueño. */}
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12.5l2.5 2.5L16 9.5" />
  </svg>
);

const IconoAbrirNota = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Flecha que da la vuelta: deshacer la entrega. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 10h11a5 5 0 0 1 0 10h-4" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6l-4 4 4 4" />
  </svg>
);

const IconoEliminar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Bote de basura, el mismo de Salidas. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

/**
 * Ajuste de la nota: descuento (negativo) o cargo extra (positivo), sale en el
 * ticket. Saltos de $10, como en el formulario.
 */
function ModalAjuste({ folio, guardado, valor, onValor, onCancelar, onGuardar, loading, error }) {
  const n = Number(valor || 0);
  const valido = Number.isFinite(n);
  const sinCambio = valido && n === Number(guardado || 0);
  const btn = 'flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">Ajuste</h3>
          <p className="text-sm text-gray-500">Nota {folio}</p>
        </div>
        <p className="text-sm text-gray-500">
          Descuento (negativo) o cargo extra (positivo) sobre el total de la nota. Sale en el ticket.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
            <input
              type="number" step="any"
              value={valor}
              onChange={e => onValor(e.target.value)}
              placeholder="0"
              aria-label="Ajuste"
              className="w-full pl-8 pr-4 py-3.5 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue focus:border-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <button type="button" onClick={() => onValor(String(n - 10))} aria-label="Disminuir ajuste" className={btn}>−</button>
          <button type="button" onClick={() => onValor(String(n + 10))} aria-label="Aumentar ajuste" className={btn}>+</button>
        </div>
        <p className="text-sm text-gray-500">
          {Number(guardado) !== 0
            ? `Guardado: ${Number(guardado) > 0 ? '+' : ''}${fmtMonto(guardado)}`
            : 'Sin ajuste'}
        </p>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            onClick={onCancelar}
            disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onGuardar}
            disabled={loading || !valido || sinCambio}
            className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Guardando...' : 'Guardar'}
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
  // Borrar una nota es solo del Admin Main.
  const esAdminMain = esAdminMainFn(usuario?.rol);

  const [nota,             setNota]             = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingAccion,    setLoadingAccion]    = useState(false);
  const [errorAccion,      setErrorAccion]      = useState('');
  const [confirmCancelar,  setConfirmCancelar]  = useState(false);
  const [motivoCancelarOpen, setMotivoCancelarOpen] = useState(false);
  const [motivoCancelar,   setMotivoCancelar]   = useState('');
  const [confirmFinalizar,  setConfirmFinalizar]  = useState(false);
  // Deshacer la entrega (solo admin): la nota vuelve a Por Entregar.
  const [confirmReabrir,    setConfirmReabrir]    = useState(false);
  // Aviso de "ya está procesada" por WhatsApp; la plantilla se escribe en Ajustes.
  const [procesadoOpen,    setProcesadoOpen]    = useState(false);
  // Demo: a quién se "mandó" el WhatsApp, que no se abre (los teléfonos de los
  // clientes de la demo podrían ser de alguien).
  const [waSimulado,       setWaSimulado]       = useState('');
  // Cambiar el nombre (referencia) del Autoservicio.
  const [refOpen,          setRefOpen]          = useState(false);
  const [refValor,         setRefValor]         = useState('');
  const [plantillaWa,      setPlantillaWa]      = useState('');
  // Recordatorio: lo que manda "Avisar" en una nota ya procesada.
  const [plantillaReaviso, setPlantillaReaviso] = useState('');

  // Un solo cobro para liquidar y abonar: lo decide el importe.
  const [cobroOpen,        setCobroOpen]        = useState(false);
  const [cobroMonto,       setCobroMonto]       = useState('');
  const [cobroForma,       setCobroForma]       = useState('');
  // Ajuste de la nota: su propio modal, junto a Cobrar.
  const [ajusteOpen,       setAjusteOpen]       = useState(false);
  const [ajusteTxt,        setAjusteTxt]        = useState('');
  const [confirmRevertirAbono, setConfirmRevertirAbono] = useState(null);
  const [motivoAbono,      setMotivoAbono]      = useState('');
  const [corrigiendoPago,  setCorrigiendoPago]  = useState(false);
  // Revertir el cobro (admin, caja abierta): el motivo es obligatorio.
  const [revirtiendoPago,  setRevirtiendoPago]  = useState(false);
  const [motivoReversion,  setMotivoReversion]  = useState('');
  const [formaPagoNueva,   setFormaPagoNueva]   = useState('');
  const [confirmEliminar,  setConfirmEliminar]  = useState(false);
  // Un cambio en Salidas movió el total y dejó la nota PENDIENTE: aquí se
  // explica cuánto falta cobrar o devolver.
  const [avisoCobro, setAvisoCobro] = useState(() => leerAvisoCobro(id));
  // ¿Hay caja abierta? Se pregunta al ir a cobrar; null = no se sabe (no se avisa).
  const [cajaAbierta,   setCajaAbierta]   = useState(null);
  const [modalCajaOpen, setModalCajaOpen] = useState(false);

  // Abre el cobro y revisa la caja. El importe arranca vacío: lo teclea quien
  // cobra con el dinero en la mano.
  function abrirCobro() {
    setErrorAccion('');
    setCobroMonto('');
    setCobroForma('');
    setCobroOpen(true);
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null));
  }

  function abrirAjuste() {
    setErrorAccion('');
    // Sin ajuste el campo abre vacío, con el 0 de placeholder.
    const actual = Number(nota?.ajuste ?? 0);
    setAjusteTxt(actual ? String(actual) : '');
    setAjusteOpen(true);
  }

  // Guarda el ajuste; se relee la nota (puede quedar pendiente por el importe nuevo).
  async function guardarAjuste() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/ajuste`, { ajuste: Number(ajusteTxt) || 0 });
      setNota(await api.get(`/notas/${id}`));
      setAjusteOpen(false);
    } catch (err) {
      // El error se ve dentro del modal.
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  // Deshace la entrega: vuelve a "Por Entregar". No mueve inventario ni cobro.
  async function reabrirNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/reabrir`, {});
      const fresca = await api.get(`/notas/${id}`);
      setNota(fresca);
      setConfirmReabrir(false);
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmReabrir(false);
    } finally {
      setLoadingAccion(false);
    }
  }

  // "Procesado": pasa la nota a Por Entregar (el único camino en Por Encargo) y
  // avisa por WhatsApp (wa.me: es texto, va directo al número). Primero el
  // estado y luego el aviso: sin teléfono o sin mensaje, la nota igual avanza.
  // Ya procesada, solo repite el aviso.
  async function enviarProcesado() {
    const avisar = () => {
      if (!mensajeProcesado.trim() || !telefonoAviso) return;
      if (ES_DEMO) {
        setWaSimulado(nota.cliente_nombre || nota.telefono || 'el cliente');
        return;
      }
      window.open(
        `https://wa.me/${telefonoAviso}?text=${encodeURIComponent(mensajeProcesado)}`,
        '_blank', 'noopener,noreferrer'
      );
    };
    if (yaProcesada) {
      avisar();
      setProcesadoOpen(false);
      return;
    }
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/estado`, { estado: 'LISTA' });
      setNota(await api.get(`/notas/${id}`));
      setProcesadoOpen(false);
      avisar();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  // Cobra la nota por /abonos, que registra el pago y, si cubre el saldo, la
  // marca PAGADA (y cierra un Autoservicio terminado). Con total $0 no hay abono:
  // se marca cobrada directo. Luego se relee la nota completa.
  async function cobrarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      if (saldoNota > 1e-9) {
        await api.post(`/notas/${id}/abonos`, {
          monto: Number(cobroMonto), forma_pago: cobroForma,
        });
      } else {
        await api.patch(`/notas/${id}/estado-pago`, {
          estado_pago: 'PAGADO', forma_pago: cobroForma,
        });
      }
      const fresca = await api.get(`/notas/${id}`);
      setNota(fresca);
      // Si quedó pagada, el aviso de cobrar la diferencia ya no aplica.
      if (fresca?.estado_pago === 'PAGADO') {
        limpiarAvisoCobro(id);
        setAvisoCobro(null);
      }
      setCobroOpen(false);
      setCobroMonto('');
      setCobroForma('');
    } catch (err) {
      // El error se ve dentro del modal.
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  // Revierte un abono (admin, con motivo); si dejaba la nota pagada, vuelve a deber.
  async function revertirAbono(abonoId) {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/abonos/${abonoId}/revertir`, { motivo: motivoAbono.trim() });
      const fresca = await api.get(`/notas/${id}`);
      setNota(fresca);
      setConfirmRevertirAbono(null);
      setMotivoAbono('');
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  useEffect(() => {
    let activo = true;
    api.get(`/notas/${id}`)
      .then(data => {
        if (!activo) return;
        setNota(data);
        // El aviso solo aplica mientras siga sin cobrarse.
        if (data?.estado_pago !== 'PENDIENTE') {
          limpiarAvisoCobro(id);
          setAvisoCobro(null);
        }
      })
      .catch(err => { if (activo) setError(err.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

  // Plantillas de WhatsApp, sin bloquear: si fallan, el botón dirá que falta el mensaje.
  useEffect(() => {
    if (nota?.tipo_servicio !== 'POR_ENCARGO') return undefined;
    let activo = true;
    api.get('/ajustes')
      .then(cfg => {
        if (!activo) return;
        setPlantillaWa(cfg?.whatsapp_mensaje_encargo ?? '');
        setPlantillaReaviso(cfg?.whatsapp_mensaje_reaviso ?? '');
      })
      .catch(() => { if (activo) { setPlantillaWa(''); setPlantillaReaviso(''); } });
    return () => { activo = false; };
  }, [nota?.tipo_servicio]);

  // Guarda el nombre libre del Autoservicio; vacío = Mostrador.
  async function guardarReferencia() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const upd = await api.patch(`/notas/${id}/referencia`, { referencia: refValor });
      setNota(prev => ({ ...prev, referencia: upd.referencia }));
      setRefOpen(false);
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  async function cancelarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/estado`, {
        estado: 'CANCELADA',
        motivo: motivoCancelar.trim() || undefined,
      });
      setNota(prev => ({ ...prev, estado: updated.estado, motivo_cancelacion: updated.motivo_cancelacion }));
      setMotivoCancelarOpen(false);
      setMotivoCancelar('');
    } catch (err) {
      setErrorAccion(err.message);
      setMotivoCancelarOpen(false);
    } finally {
      setLoadingAccion(false);
    }
  }

  async function eliminarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}`);
      navigate(urlListaNotas());
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

  // Revierte el cobro (PAGADO → PENDIENTE) para cancelar o volver a cobrar. Solo
  // admin, con motivo y con su caja abierta; queda aviso en la campana.
  async function revertirPago() {
    const motivo = motivoReversion.trim();
    if (!motivo) return;
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/estado-pago`, {
        estado_pago: 'PENDIENTE',
        motivo,
      });
      // Ya sin cobro, no se puede revertir otra vez.
      setNota(prev => ({
        ...prev,
        estado_pago: updated.estado_pago,
        forma_pago: updated.forma_pago,
        forma_pago_editable: false,
        pago_reversible: false,
      }));
      setRevirtiendoPago(false);
      setMotivoReversion('');
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  // Corrige la forma de pago de una nota cobrada (admin, con su caja abierta).
  async function corregirFormaPago() {
    if (!formaPagoNueva) return;
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/forma-pago`, { forma_pago: formaPagoNueva });
      setNota(prev => ({ ...prev, forma_pago: updated.forma_pago }));
      setCorrigiendoPago(false);
      setFormaPagoNueva('');
    } catch (err) {
      setErrorAccion(err.message);
      setCorrigiendoPago(false);
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

  const terminal     = esTerminal(nota);
  // Máquinas de la nota y cuáles corren ahora (como la tarjeta de Notas).
  const maquinasEnUso = new Set(nota.maquinas_en_uso ?? []);
  const maquinasNota = [...new Set([...(nota.maquinas_nombres ?? []), ...maquinasEnUso])]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  // Cancelar: de admin (por ahora también de empleados), sin cobro ni abonos
  // (para eso está revertir).
  const puedeCancelar = (esAdmin || EMPLEADOS_CANCELAN)
    && !['CANCELADA', 'PAGADA'].includes(nota.estado)
    && nota.estado_pago !== 'PAGADO'
    && Number(nota.abonado ?? 0) === 0;
  // Cobrar se puede en cualquier estado menos cancelada (en Por Encargo suelen
  // pagar al dejar la ropa); sale también con la nota cerrada si quedó debiendo.
  // En Por Encargo el último paso es ENTREGAR y un admin lo puede deshacer.
  const esEncargoNota = nota.tipo_servicio === 'POR_ENCARGO';

  // Nombre de un renglón. En Por Encargo, los que traen precio son SERVICIOS y
  // los demás MÁQUINAS agregadas en Salidas; se numeran por separado.
  const nombreDeCarga = (cg) => {
    if (!esEncargoNota) return `Carga ${cg.orden}`;
    const esServicio = cg.tope_carga != null;
    const n = (nota.cargas ?? []).filter(x => (x.tope_carga != null) === esServicio).indexOf(cg) + 1;
    return `${esServicio ? 'Servicio' : 'Máquina'} ${n}`;
  };
  // Abonado y saldo, calculados por el servidor.
  const abonosNota = nota.abonos ?? [];
  const abonadoNota = Number(nota.abonado ?? 0);
  const saldoNota = Number(nota.saldo ?? nota.precio_total ?? 0);
  // "Procesado" (solo Por Encargo): el único camino a Por Entregar; suelta las
  // máquinas y avisa por WhatsApp. Ya procesada, repite el aviso. Se muestra
  // aunque falte mensaje o teléfono (lo explica el modal).
  const yaProcesada = nota.estado === 'LISTA';
  // Ya procesada, "Avisar" manda el recordatorio (o, si no hay, el mensaje normal).
  const plantillaAviso = yaProcesada && hayMensajeWhatsapp(plantillaReaviso)
    ? plantillaReaviso
    : plantillaWa;
  const mensajeProcesado = armarMensajeWhatsapp(plantillaAviso, nota);
  // Teléfono del aviso: el del cliente o el capturado en la nota.
  const telefonoAviso = telefonoWhatsapp(nota.cliente_telefono || nota.telefono);
  // Aparece cuando terminó al menos una lavadora.
  const botonProcesado = nota.tipo_servicio === 'POR_ENCARGO' && !esTerminal(nota)
    && (yaProcesada || nota.lavadora_terminada) && (
    <AccionCircular
      label={yaProcesada ? 'Avisar' : 'Procesado'}
      title={yaProcesada ? 'Volver a avisarle al cliente' : 'Marcar la nota como procesada'}
      icono={yaProcesada ? IconoAvisar : IconoProcesado}
      // Procesado en verde, como Entregar; Avisar en azul.
      color={yaProcesada ? 'bg-blue group-hover:bg-blue-700' : 'bg-green-500 group-hover:bg-green-600'}
      onClick={() => { setErrorAccion(''); setProcesadoOpen(true); }}
      disabled={loadingAccion}
    />
  );
  const botonSalidas = (
    <AccionCircular
      label="Salidas"
      icono={IconoSalidas}
      color="bg-blue group-hover:bg-blue-700"
      onClick={() => navigate(`/notas/${id}/salidas`)}
    />
  );
  const botonCobrar = puedeLiquidar(nota) && (
    <AccionCircular
      label="Cobrar"
      icono={IconoCobrar}
      color="bg-blue group-hover:bg-green-600"
      onClick={abrirCobro}
      disabled={loadingAccion}
    />
  );
  // Solo Por Encargo, con la nota viva y sin cobro congelado.
  const botonAjuste = esEncargoNota && !esTerminal(nota) && !nota.cobro_congelado && (
    <AccionCircular
      label="Ajuste"
      title="Descuento o cargo extra"
      icono={IconoAjuste}
      color="bg-blue group-hover:bg-blue-700"
      onClick={abrirAjuste}
      disabled={loadingAccion}
    />
  );
  // Nota cerrada: Abrir (deshacer la entrega) y si queda algún botón.
  const puedeReabrir = esAdmin && esEncargoNota && nota.estado === 'FINALIZADA';
  const hayAccionesCerrada = Boolean(botonCobrar) || puedeReabrir || puedeEliminar(nota, esAdminMain);
  const badgeTipoServicio    = BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? BADGE_TIPO_SERVICIO.AUTOSERVICIO;
  const badgePago     = BADGE_PAGO[nota.estado_pago];
  const barcodeValue  = nota.folio ?? String(nota.id);
  const pasos         = pasosDeNota(nota);
  const pasoActual    = progresoPasos(nota, pasos);
  const fechaPorEstado = Object.fromEntries(
    (nota.historial_estados || []).map(h => [h.estado, h.created_at])
  );

  /* Los de la nota y los de cada carga; el granel de un servicio con tope va incluido. */
  const productosNota = [
    ...(nota.productos || []).map(p => ({ ...p, carga: null, incluido: p.es_por_medida && Number(p.subtotal) === 0 })),
    ...(nota.cargas ?? []).flatMap(cg => (cg.productos ?? []).map(p => ({
      ...p,
      carga: cg,
      incluido: (p.es_por_medida && Number(p.subtotal) === 0)
        || (cg.tope_carga != null && !seVendePorUnidad(p)),
    }))),
  ];
  const totalProductos = productosNota.reduce(
    (s, p) => s + (p.incluido ? 0 : Number(p.subtotal)), 0
  );

  return (
    <div className="min-h-full bg-slate-100">

      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-movil md:max-w-2xl mx-auto px-6 md:px-6 pt-10 md:pt-6 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate(urlListaNotas())}
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
            {/* El cliente: el del catálogo, la referencia del Autoservicio o Mostrador. */}
            <p className="text-sm text-gray-500 leading-tight truncate">
              {nota.cliente_nombre
                ? `${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`
                : (nota.referencia || 'Mostrador')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => navigate(`/notas/${id}/ticket`)}
            aria-label="Ver ticket"
            title="Ver el ticket para enviar por WhatsApp"
            className="w-11 h-11 hover:opacity-80 flex items-center justify-center transition-opacity"
          >
            {/* El mismo recibo que Ajustes → Ticket (Lucide "receipt"). */}
            <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5 4 2Z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 8h8M8 12h8M8 16h5" />
            </svg>
          </button>
        </div>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-movil md:max-w-2xl mx-auto px-6 md:p-6 py-6">

      {/* Error de acción */}
      {errorAccion && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorAccion}
        </div>
      )}

      {/* Botones de acción */}
      {!terminal && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-6 mt-2">
          {puedeCancelar && (
            <AccionCircular
              label="Cancelar"
              title="Cancelar la nota"
              icono={IconoCancelar}
              color="bg-blue group-hover:bg-orange-600"
              onClick={() => setConfirmCancelar(true)}
              disabled={loadingAccion}
            />
          )}
          {/* Admin en Por Encargo: Procesado, Salidas, Ajuste y Cobrar; lo demás: Ajuste, Cobrar, Salidas y Procesado. */}
          {esAdmin && esEncargoNota
            ? <>{botonProcesado}{botonSalidas}{botonAjuste}{botonCobrar}</>
            : <>{botonAjuste}{botonCobrar}{botonSalidas}{botonProcesado}</>}
          {/* Último paso; exige el cobro. En Por Encargo dice ENTREGAR. */}
          {puedeFinalizar(nota) && (
            <AccionCircular
              label={esEncargoNota ? 'Entregar' : 'Finalizar'}
              icono={IconoEntregar}
              // Entregar en verde.
              color={esEncargoNota ? 'bg-green-500 group-hover:bg-green-600' : 'bg-blue group-hover:bg-emerald-700'}
              onClick={() => setConfirmFinalizar(true)}
              disabled={loadingAccion}
            />
          )}
          {puedeEliminar(nota, esAdminMain) && (
            <AccionCircular
              label="Eliminar"
              icono={IconoEliminar}
              color="bg-blue group-hover:bg-red-700"
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
            />
          )}
        </div>
      )}
      {/* Ya cerrada se ve en todos los tamaños; si quedó debiendo, se puede cobrar. */}
      {terminal && hayAccionesCerrada && (
        <div className="flex flex-wrap items-start gap-2">
          {botonCobrar}
          {/* Deshacer la entrega (admin): vuelve a Por Entregar. */}
          {puedeReabrir && (
            <AccionCircular
              label="Abrir"
              title="Deshacer la entrega"
              icono={IconoAbrirNota}
              color="bg-amber-600 group-hover:bg-amber-700"
              onClick={() => { setErrorAccion(''); setConfirmReabrir(true); }}
              disabled={loadingAccion}
            />
          )}
          {puedeEliminar(nota, esAdminMain) && (
            <AccionCircular
              label="Eliminar"
              icono={IconoEliminar}
              color="bg-red-600 group-hover:bg-red-700"
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
            />
          )}
        </div>
      )}

      {/* Sin botones (nota cerrada sin acciones), sin el espacio de arriba. */}
      <div className={`space-y-6 ${!terminal || hayAccionesCerrada ? 'mt-12' : ''}`}>

            {/* Un cambio en Salidas dejó la nota pendiente: hay que cobrar el importe nuevo. */}
      {/* Demo: el aviso por WhatsApp se finge, no se abre. */}
      {waSimulado && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3" role="status">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-green-900">Mensaje enviado por WhatsApp a {waSimulado}</p>
            <p className="text-sm text-green-800 mt-0.5">
              En la demostración no se abre WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWaSimulado('')}
            aria-label="Cerrar aviso"
            className="text-green-600 hover:text-green-800 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {avisoCobro && nota.estado_pago === 'PENDIENTE' && nota.estado !== 'CANCELADA' && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Esta nota quedó pendiente de cobro</p>
            <p className="text-sm text-amber-800 mt-0.5">
              Cambió en Salidas y el total {avisoCobro.ahora > avisoCobro.antes ? 'subió' : 'bajó'} de{' '}
              <span className="font-medium">{fmtMonto(avisoCobro.antes)}</span> a{' '}
              <span className="font-medium">{fmtMonto(avisoCobro.ahora)}</span>, así que el pago
              anterior ya no corresponde.{' '}
              {avisoCobro.ahora > avisoCobro.antes
                ? `Cobra la diferencia de ${fmtMonto(avisoCobro.ahora - avisoCobro.antes)} y vuelve a liquidarla.`
                : `Devuelve ${fmtMonto(avisoCobro.antes - avisoCobro.ahora)} y vuelve a liquidarla.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { limpiarAvisoCobro(id); setAvisoCobro(null); }}
            aria-label="Cerrar aviso"
            className="text-amber-600 hover:text-amber-800 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Cuánto falta cobrar (o lo cobrado), arriba y en grande. No en canceladas. */}
      {nota.estado !== 'CANCELADA' && (
        nota.estado_pago === 'PENDIENTE' ? (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-700 uppercase tracking-wide">Pendiente de cobro</p>
              {/* Con abonos, el monto grande es el saldo y debajo de cuánto viene. */}
              <p className="text-3xl font-bold text-amber-900 leading-tight mt-0.5">{fmtMonto(saldoNota)}</p>
              {abonadoNota > 0 && (
                <p className="text-sm text-amber-800 mt-1">
                  Abonado {fmtMonto(abonadoNota)} de {fmtMonto(nota.precio_total)}
                </p>
              )}
            </div>
            <svg className="w-8 h-8 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 mt-12">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">
                  Cobrada{nota.forma_pago ? ` · ${formaPagoLabel(nota.forma_pago)}` : ''}
                </p>
                <p className="text-xl font-bold text-emerald-900 leading-tight mt-0.5">{fmtMonto(nota.precio_total)}</p>
              </div>
              <svg className="w-7 h-7 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {/* Corregir la forma de pago, solo con su caja abierta (lo calcula el servidor). */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {esAdmin && nota.forma_pago_editable && (
                <button
                  type="button"
                  onClick={() => { setFormaPagoNueva(''); setCorrigiendoPago(true); }}
                  className="text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
                >
                  Corregir forma de pago
                </button>
              )}
              {/* Revertir deja la nota pendiente: luego se cancela o se cobra bien. */}
              {esAdmin && nota.pago_reversible && !terminal && (
                <button
                  type="button"
                  onClick={() => { setMotivoReversion(''); setErrorAccion(''); setRevirtiendoPago(true); }}
                  className="text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
                >
                  Revertir pago
                </button>
              )}
            </div>
          </div>
        )
      )}

      </div>


      <div className='space-y-6 mt-6'>

      {/* De quién es y cuál es, en grande: lo que se busca desde el mostrador. */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-5 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide"># Nota</p>
          {/* Solo el consecutivo (1806): con él se pide la nota en el mostrador. */}
          <p className="text-2xl font-bold text-gray-900 leading-tight mt-0.5 truncate">
            {nota.folio?.split('-')[0] ?? nota.id}
          </p>
          <div className="flex items-baseline gap-2 mt-1 min-w-0">
            <p className="text-sm text-gray-600 truncate">
              {nota.cliente_nombre
                ? `${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`
                // Mostrador se lee como un cliente más; antes va la referencia del Autoservicio.
                : (nota.referencia || 'Mostrador')}
            </p>
            {/* Autoservicio: ponerle o cambiarle el nombre. */}
            {nota.tipo_servicio === 'AUTOSERVICIO' && nota.estado !== 'CANCELADA' && (
              <button
                type="button"
                onClick={() => { setErrorAccion(''); setRefValor(nota.referencia ?? ''); setRefOpen(true); }}
                className="flex-shrink-0 text-sm text-blue underline underline-offset-2"
              >
                Cambiar
              </button>
            )}
          </div>
        </div>
        <svg className="w-8 h-8 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>

      {/* Máquinas de la nota: en azul la que corre ahora; en gris las asignadas o
          ya usadas. */}
      {maquinasNota.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-4 py-4">
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            {maquinasNota.length === 1 ? 'Máquina' : 'Máquinas'}
          </p>
          <p className="text-lg font-bold mt-0.5">
            {maquinasNota.map((m, i) => (
              <span key={m} className={maquinasEnUso.has(m) ? 'text-blue-700' : 'text-gray-500'}>
                {m}{i < maquinasNota.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Productos: en la venta de productos siempre; en los demás servicios, si llevan. */}
      {(nota.tipo_servicio === 'PRODUCTOS' || productosNota.length > 0) && (
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
          {productosNota.length > 0 && (
            <span className="text-sm text-gray-400">{productosNota.length} ítem(s)</span>
          )}
        </div>
        {productosNota.length === 0 ? (
          <p className="text-sm text-gray-400 italic px-4 py-4">Sin productos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* Con cargas, en el orden de las cargas. */}
            {((nota.cargas ?? []).length > 0
              ? productosNota
              : [...productosNota].sort((a, b) => ordenProducto(a) - ordenProducto(b))
            ).map(p => {
              const { incluido } = p;
              return (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{tituloProducto(p)}</p>
                  <p className="text-sm text-gray-400">
                    {p.carga && `${nombreDeCarga(p.carga)} · `}
                    {subtituloProducto(p) && `${subtituloProducto(p)} · `}
                    {incluido
                      ? `${p.cantidad} ${unidadProdTxt(p)}`
                      : `${p.cantidad} ${unidadProdTxt(p)} × ${fmtMonto(p.precio_unitario)}`}
                  </p>
                </div>
                <span className="text-sm font-semibold flex-shrink-0">
                  {incluido
                    ? <span className="text-green-700">Incluido</span>
                    : <span className="text-gray-700">{fmtMonto(p.subtotal)}</span>}
                </span>
              </div>
              );
            })}
            <div className="px-4 py-3 flex justify-between bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">Total productos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalProductos)}</span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Código de barras: apagado, no borrado (ver MOSTRAR_CODIGO_BARRAS). */}
      {MOSTRAR_CODIGO_BARRAS && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex justify-center shadow-sm">
          <Barcode value={barcodeValue} height={50} fontSize={12} />
        </div>
      )}

      {/* Entrega: solo Por Encargo (lo demás se lo lleva el cliente en el momento). */}
      {!['AUTOSERVICIO', 'PRODUCTOS'].includes(nota.tipo_servicio) && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Entrega</h2>
          </div>
          <div className="px-4">
            <FilaDetalle label="Día que estará lista">
              {nota.tiempo_entrega
                ? (TIEMPO_ENTREGA_LABEL[nota.tiempo_entrega] ?? nota.tiempo_entrega)
                : <span className="text-gray-400">—</span>}
            </FilaDetalle>
            <FilaDetalle label="Instrucciones">
              {nota.instrucciones ?? <span className="text-gray-400">—</span>}
            </FilaDetalle>
          </div>
        </div>
      )}

      {/* Información de la nota */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Detalles</h2>
        </div>
        <div className="px-4">
          <FilaDetalle label="Servicio">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeTipoServicio.cls}`}>
              {badgeTipoServicio.label}
            </span>
            {nota.tamano && <span className="ml-2 text-sm text-gray-500 capitalize">{nota.tamano}</span>}
          </FilaDetalle>
          <FilaDetalle label="ID">
            <span className="text-sm font-medium text-gray-800">{nota.id}</span>
          </FilaDetalle>
          <FilaDetalle label="# Nota">
            <span className="text-sm font-medium text-gray-800">{nota.folio ?? `#${nota.id}`}</span>
          </FilaDetalle>
          <FilaDetalle label="Fecha">
            {fmtFecha(nota.created_at)}
          </FilaDetalle>
          <FilaDetalle label="Hora">
            {fmtHora(nota.created_at)}
          </FilaDetalle>
          {nota.usuario_nombre && (
            <FilaDetalle label="Atendió">
              <span className="text-sm font-medium text-gray-800">{nota.usuario_nombre}</span>
            </FilaDetalle>
          )}
          {nota.sucursal_nombre && (
            <FilaDetalle label="Sucursal">
              <span className="text-sm font-medium text-gray-800">{nota.sucursal_nombre}</span>
            </FilaDetalle>
          )}
          {/* La venta de productos no recibe ropa. */}
          {(nota.cargas ?? []).length === 0 && nota.tipo_servicio !== 'PRODUCTOS'
            && nota.tipo_prenda && PRENDA_LABEL[nota.tipo_prenda] && (
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
          {/* Una nota cancelada no tiene estado de pago: no se va a cobrar. */}
          {nota.estado !== 'CANCELADA' && (
            <FilaDetalle label="Estado de pago">
              {badgePago
                ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
                : <span className="text-gray-400">—</span>}
            </FilaDetalle>
          )}
          {nota.forma_pago && (
            <FilaDetalle label="Forma de pago">
              <span className="text-gray-700">{formaPagoLabel(nota.forma_pago)}</span>
            </FilaDetalle>
          )}
          {/* Correcciones de forma de pago: quién y cuándo. */}
          {(nota.historial_forma_pago ?? []).length > 0 && (
            <FilaDetalle label="Correcciones de pago">
              <div className="space-y-1.5">
                {nota.historial_forma_pago.map((h, i) => (
                  <div key={i} className="text-sm text-gray-500">
                    <span className="font-medium text-gray-700">
                      {formaPagoLabel(h.forma_anterior)} → {formaPagoLabel(h.forma_nueva)}
                    </span>
                    <span className="block">
                      {h.usuario_nombre ?? 'Usuario eliminado'} · {formatFechaHora12(h.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </FilaDetalle>
          )}
          {/* Abonos con su forma, quién lo tomó y cuándo; los revertidos, tachados. */}
          {abonosNota.length > 0 && (
            <FilaDetalle label="Abonos">
              <div className="space-y-2">
                {abonosNota.map(ab => {
                  const revertido = ab.revertido_at != null;
                  return (
                    <div key={ab.id} className="text-sm text-gray-500">
                      <span className={`font-medium ${revertido ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {fmtMonto(ab.monto)} · {formaPagoLabel(ab.forma_pago)}
                      </span>
                      <span className="block">
                        {ab.usuario_nombre ?? 'Usuario eliminado'} · {formatFechaHora12(ab.created_at)}
                      </span>
                      {revertido && (
                        <span className="block text-gray-400">
                          Revertido: {ab.motivo_reversion}
                        </span>
                      )}
                      {esAdmin && ab.reversible && !terminal && (
                        <button
                          type="button"
                          onClick={() => { setMotivoAbono(''); setErrorAccion(''); setConfirmRevertirAbono(ab); }}
                          className="mt-0.5 text-sm font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                        >
                          Revertir abono
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="text-sm font-semibold text-gray-700 pt-1 border-t border-gray-100">
                  Abonado {fmtMonto(abonadoNota)} · Falta {fmtMonto(saldoNota)}
                </div>
              </div>
            </FilaDetalle>
          )}
          {(nota.cargas ?? []).length > 0 && (
            <FilaDetalle label="Cargas">
              <div className="space-y-3">
                {nota.cargas.map(cg => {
                  // Una línea por vuelta (un relavado repite la máquina). La que sigue puesta
                  // muestra su estado en vivo; las demás, "terminado". El importe va solo en la
                  // primera vuelta de cada hueco (la cobrada).
                  const usadas = cg.maquinas_usadas ?? [];
                  const primeraDe = (slot) => usadas.find(u => u.slot === slot)?.id ?? null;
                  const primeraLav = primeraDe('lavadora');
                  const primeraSec = primeraDe('secadora');
                  const maquinasCarga = usadas.map(u => {
                    const esLav = u.slot === 'lavadora';
                    const esPrimera = u.id === (esLav ? primeraLav : primeraSec);
                    const estadoVivo = esLav ? cg.lavadora_estado : cg.secadora_estado;
                    return {
                      nombre: u.nombre, tipo: u.tipo, tamano: esLav ? undefined : u.tamano,
                      // Puesta: estado en vivo; cerrada: "terminado".
                      estado: u.actual ? estadoVivo : 'terminado',
                      precio: esPrimera
                        ? Number(esLav ? cg.precio_lavadora : cg.precio_secadora)
                        : null,
                    };
                  });
                  // Por Encargo: huecos con tipo y sin máquina (se asignan en Salidas).
                  const TIPO_MAQ_LABEL = { mediana: 'Mediana', jumbo: 'Jumbo', edredon: 'Edredón' };
                  const hayDelSlot = (slot) => usadas.some(u => u.slot === slot);
                  const slotsPrevistos = [
                    !hayDelSlot('lavadora') && cg.lavadora_tipo_previsto && {
                      label: `Lavadora ${TIPO_MAQ_LABEL[cg.lavadora_tipo_previsto] ?? cg.lavadora_tipo_previsto}`,
                      precio: Number(cg.precio_lavadora),
                    },
                    !hayDelSlot('secadora') && cg.secadora_tipo_previsto && {
                      label: `Secadora`,
                      precio: Number(cg.precio_secadora),
                    },
                  ].filter(Boolean);
                  const prods = cg.productos ?? [];
                  const totalProds = prods.reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
                  // Lo que la carga cobra: en Por Encargo, el precio del servicio + marca +
                  // ajuste (como el total de la nota).
                  const marcaProds = prods
                    .filter(seVendePorUnidad)
                    .reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
                  const totalCarga = cg.tope_carga != null
                    ? Number(cg.tope_carga) + marcaProds + Number(cg.ajuste ?? 0)
                    : Number(cg.precio_lavadora) + Number(cg.precio_secadora)
                      + Number(cg.ajuste ?? 0) + totalProds;
                  // En Por Encargo, el renglón con precio es un servicio; sin él, una máquina de Salidas.
                  const esServicioEncargo = esEncargoNota && cg.tope_carga != null;
                  // La máquina de Por Encargo no lleva importe (lo cobrado es el servicio); en
                  // Autoservicio sí.
                  const maquinaSinPrecio = esEncargoNota && !esServicioEncargo;
                  // Autoservicio no maneja prenda, tela ni tamaño.
                  const atributos = nota.tipo_servicio === 'AUTOSERVICIO' ? [] : [
                    PRENDA_LABEL[cg.tipo_prenda],
                    cg.tipo_tela,
                    cg.tamano_edredon,
                    cg.tamano ? cg.tamano.charAt(0).toUpperCase() + cg.tamano.slice(1) : null,
                  ].filter(Boolean);
                  return (
                    <div key={cg.id} className="border border-gray-100 rounded-lg p-3 space-y-1.5">
                      {/* Carga N y, debajo, una línea por máquina con su costo. */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-500">
                          {nombreDeCarga(cg)}
                        </span>
                        {!maquinaSinPrecio && (
                          <span className="text-sm font-medium text-gray-700">{fmtMonto(totalCarga)}</span>
                        )}
                      </div>
                      {maquinasCarga.length === 0 && slotsPrevistos.length === 0 ? (
                        // Un servicio no lleva máquina: van en sus renglones.
                        esServicioEncargo ? null : (
                          <span className="text-sm text-gray-400 italic">Sin máquinas</span>
                        )
                      ) : (
                        maquinasCarga.map((m, i) => {
                          const cfg = BADGE_MAQUINA_ESTADO[m.estado];
                          // El tamaño (M/J) solo en lavadoras.
                          const tamanoLabel = m.tipo === 'secadora' ? null : MAQUINA_TIPO_LABEL[m.tipo];
                          const tipoLabel = tamanoLabel ? (TAMANO_ABBR[tamanoLabel] ?? tamanoLabel) : null;
                          return (
                            <div key={i} className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                                {/* Estado: el punto de color */}
                                {cfg && (
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`}
                                    title={cfg.label}
                                  />
                                )}
                                <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                                {tipoLabel && (
                                  <span className="text-sm text-gray-500">— {tipoLabel}</span>
                                )}
                              </div>
                              {/* Sin importe: vuelta repetida o máquina de Por Encargo. */}
                              {m.precio != null && !maquinaSinPrecio && (
                                <span className="flex-shrink-0 text-sm text-gray-600">{fmtMonto(m.precio)}</span>
                              )}
                            </div>
                          );
                        })
                      )}
                      {slotsPrevistos.map((s, i) => (
                        <div key={`prev-${i}`} className="flex items-start justify-between gap-2">
                          <span className="text-sm text-gray-600 min-w-0">
                            {s.label} <span className="text-gray-400 italic">— sin asignar</span>
                          </span>
                          <span className="flex-shrink-0 text-sm text-gray-600">{fmtMonto(s.precio)}</span>
                        </div>
                      ))}
                      {atributos.length > 0 && (
                        <p className="text-sm text-gray-500">{atributos.join(' · ')}</p>
                      )}
                      {prods.map(p => (
                        <p key={p.id} className="text-sm text-gray-500">
                          {p.es_por_medida && Number(p.subtotal) === 0
                            ? <>{etiquetaProducto(p)} · {p.cantidad} {unidadProdTxt(p)} · <span className="text-green-700 font-medium">Incluido</span></>
                            : <>{etiquetaProducto(p)} · {p.cantidad} {unidadProdTxt(p)} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}</>}
                        </p>
                      ))}
                      {Number(cg.ajuste) !== 0 && (
                        <p className="text-sm text-gray-500">
                          Ajuste: {Number(cg.ajuste) > 0 ? '+' : ''}{fmtMonto(cg.ajuste)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </FilaDetalle>
          )}
          {/* Un recuadro por producto, como las cargas. */}
          {productosNota.length > 0 && (
            <FilaDetalle label="Productos">
              <div className="space-y-3">
                {((nota.cargas ?? []).length > 0
                  ? productosNota
                  : [...productosNota].sort((a, b) => ordenProducto(a) - ordenProducto(b))
                ).map(p => (
                  <div key={p.id} className="border border-gray-100 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-500 min-w-0">{tituloProducto(p)}</span>
                      {p.incluido
                        ? <span className="flex-shrink-0 text-sm font-medium text-green-700">Incluido</span>
                        : <span className="flex-shrink-0 text-sm font-medium text-gray-700">{fmtMonto(p.subtotal)}</span>}
                    </div>
                    <p className="text-sm text-gray-500">
                      {p.carga && `${nombreDeCarga(p.carga)} · `}
                      {subtituloProducto(p) && `${subtituloProducto(p)} · `}
                      {p.incluido
                        ? `${p.cantidad} ${unidadProdTxt(p)}`
                        : `${p.cantidad} ${unidadProdTxt(p)} × ${fmtMonto(p.precio_unitario)}`}
                    </p>
                  </div>
                ))}
              </div>
            </FilaDetalle>
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
              // Mostrador se lee como un cliente más; antes va la referencia del Autoservicio.
              : (nota.referencia || 'Mostrador')}
          </FilaDetalle>
          <FilaDetalle label="Ajuste">
            {nota.ajuste != null ? fmtMonto(nota.ajuste) : '—'}
          </FilaDetalle>
          <FilaDetalle label="Precio total">
            <span className="font-semibold text-gray-900">{fmtMonto(nota.precio_total)}</span>
          </FilaDetalle>
        </div>
      </div>

      </div>


      {/* Estado: oculto (MOSTRAR_ESTADO_NOTA). */}
      {MOSTRAR_ESTADO_NOTA && (<>
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
                <p className="text-sm text-gray-400">
                  {nota.motivo_cancelacion ? `Motivo: ${nota.motivo_cancelacion}` : 'Esta nota fue cancelada'}
                </p>
              </div>
            </div>
          ) : (
            <ol className="relative">
              {pasos.map((paso, i) => {
                const done    = i < pasoActual;
                const current = i === pasoActual;
                const isLast  = i === pasos.length - 1;
                // Cargas con alguna máquina en uso, bajo el mismo paso, con su fase.
                const cargasAqui = paso.key !== 'PROCESO' ? [] : (nota.cargas ?? []).filter(cg =>
                  (cg.lavadora_id && cg.lavadora_estado === 'en_uso')
                  || (cg.secadora_id && cg.secadora_estado === 'en_uso'));
                // Se resalta si ya pasó, es el actual o tiene una carga viviéndolo.
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
                        {etiquetaEstadoNota(paso.key, nota.tipo_servicio, paso.label)}
                      </p>
                      <p className="text-sm text-gray-400">{subtituloEstado(paso.key, { done, current }, fechaDePaso(paso, fechaPorEstado))}</p>

                      {/* En qué fase va cada carga que está en máquina. */}
                      {cargasAqui.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {cargasAqui.map(cg => (
                            <div key={cg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                              <span className="font-semibold text-gray-500">{nombreDeCarga(cg)}</span>
                              {cg.lavadora_id && cg.lavadora_estado === 'en_uso' && (
                                <FaseChip label="Lavado" fase={faseMaquina(cg.lavadora_id, cg.lavadora_usada_id, cg.lavadora_estado)} />
                              )}
                              {cg.secadora_id && cg.secadora_estado === 'en_uso' && (
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
      </>)}
      </div>

      {/* Modal confirmar cancelación → abre el modal del motivo */}
      {confirmCancelar && (
        <ModalConfirmar
          titulo="Cancelar nota"
          mensaje={`¿Cancelar la nota ${nota.folio ?? `#${nota.id}`}? Esta acción liberará el stock reservado y no se puede deshacer.`}
          onCancelar={() => setConfirmCancelar(false)}
          onConfirmar={() => { setConfirmCancelar(false); setMotivoCancelar(''); setMotivoCancelarOpen(true); }}
          loading={false}
          colorBtn="bg-orange-500 hover:bg-orange-600"
        />
      )}

      {/* Modal del nombre (referencia) del Autoservicio */}
      {refOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <form
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4"
            onSubmit={e => { e.preventDefault(); guardarReferencia(); }}
          >
            <div>
              <h3 className="text-base font-semibold text-gray-900">Cliente / referencia</h3>
              <p className="text-sm text-gray-500 mt-0.5">Nombre o seña del cliente. Déjalo vacío para que diga Mostrador.</p>
            </div>
            <input
              type="text"
              autoFocus
              maxLength={80}
              value={refValor}
              onChange={e => setRefValor(e.target.value)}
              placeholder="Nombre o seña del cliente"
              className="w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
            />
            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorAccion}</div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setRefOpen(false); setErrorAccion(''); }}
                disabled={loadingAccion}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loadingAccion}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingAccion ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal del motivo de cancelación */}
      {motivoCancelarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Motivo de cancelación</h3>
              <p className="text-sm text-gray-500 mt-0.5">Anota por qué se cancela la nota (opcional).</p>
            </div>
            <textarea
              value={motivoCancelar}
              onChange={e => setMotivoCancelar(e.target.value)}
              rows={3}
              placeholder="Ej. El cliente ya no quiere el servicio"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition resize-none"
            />
            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorAccion}</div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setMotivoCancelarOpen(false); setErrorAccion(''); }}
                disabled={loadingAccion}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={cancelarNota}
                disabled={loadingAccion}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingAccion ? 'Cancelando...' : 'Cancelar nota'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar el aviso por WhatsApp con el mensaje ya armado: última
          oportunidad de ver un comodín mal escrito. */}
      {procesadoOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {yaProcesada ? 'Volver a avisar al cliente' : 'Marcar la nota como procesada'}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {/* Primero lo que hace (la nota avanza); el aviso puede no tener a quién. */}
                {!yaProcesada && <>La nota pasa a <span className="font-medium text-gray-700">Por Entregar</span> y suelta sus máquinas. </>}
                {nota.cliente_nombre
                  ? <>Se le avisa por WhatsApp a <span className="font-medium text-gray-700">{nota.cliente_nombre}</span>
                      {nota.cliente_telefono ? ` (${nota.cliente_telefono})` : ''}.</>
                  : nota.telefono
                    ? <>Es una nota de <span className="font-medium text-gray-700">Mostrador</span>: se le avisa al {nota.telefono}, el teléfono que se capturó para el ticket.</>
                    : <>Es una nota de <span className="font-medium text-gray-700">Mostrador</span>, sin teléfono capturado.</>}
              </p>
            </div>

            {!hayMensajeWhatsapp(plantillaAviso) ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">Todavía no hay mensaje escrito</p>
                <p className="mt-0.5 text-sm text-amber-800">
                  Se escribe una sola vez en Ajustes → WhatsApp y sirve para todas las notas.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/ajustes')}
                  className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors"
                >
                  Ir a Ajustes
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <p className="text-sm font-semibold text-green-800 uppercase tracking-wide">Mensaje</p>
                <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {mensajeProcesado}
                </p>
              </div>
            )}

            {hayMensajeWhatsapp(plantillaAviso) && !telefonoAviso && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                {nota.cliente_nombre
                  ? 'El cliente no tiene teléfono capturado, así que no hay a dónde mandarlo.'
                  : 'No hay teléfono capturado, así que no hay a dónde mandarlo. Se pide al mandar el ticket.'}
                {!yaProcesada && ' La nota se marca igual: el aviso es aparte.'}
              </div>
            )}

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button
                onClick={() => setProcesadoOpen(false)}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={enviarProcesado}
                // Marcar no depende del aviso; solo el botón que únicamente avisa necesita
                // mensaje y teléfono.
                disabled={loadingAccion || (yaProcesada && (!mensajeProcesado.trim() || !telefonoAviso))}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingAccion ? 'Guardando...' : yaProcesada ? 'Enviar' : 'Marcar procesada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cobro (liquidar o abonar) */}
      {cobroOpen && (
        <ModalCobrar
          folio={nota.folio ?? `#${nota.id}`}
          saldo={saldoNota}
          abonado={abonadoNota}
          total={nota.precio_total}
          monto={cobroMonto}
          onMonto={setCobroMonto}
          formaPago={cobroForma}
          onFormaPago={setCobroForma}
          onCancelar={() => { setCobroOpen(false); setCobroForma(''); setErrorAccion(''); }}
          onConfirmar={cobrarNota}
          loading={loadingAccion}
          error={errorAccion}
          cajaAbierta={cajaAbierta}
          onAbrirCaja={() => setModalCajaOpen(true)}
        />
      )}

      {ajusteOpen && (
        <ModalAjuste
          folio={nota.folio ?? `#${nota.id}`}
          guardado={nota.ajuste ?? 0}
          valor={ajusteTxt}
          onValor={setAjusteTxt}
          onCancelar={() => { setAjusteOpen(false); setErrorAccion(''); }}
          onGuardar={guardarAjuste}
          loading={loadingAccion}
          error={errorAccion}
        />
      )}

      {confirmRevertirAbono && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Revertir abono</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                Se deshace el abono de {fmtMonto(confirmRevertirAbono.monto)}: sale del corte
                de su caja y la nota vuelve a deber ese dinero.
              </p>
            </div>
            <div>
              <label htmlFor="motivo-abono" className="block text-sm font-medium text-gray-700 mb-1">
                Motivo
              </label>
              <textarea
                id="motivo-abono"
                value={motivoAbono}
                onChange={e => setMotivoAbono(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Ej. Se capturó de más"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition resize-none"
              />
            </div>
            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorAccion}</div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmRevertirAbono(null); setMotivoAbono(''); setErrorAccion(''); }}
                disabled={loadingAccion}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={() => revertirAbono(confirmRevertirAbono.id)}
                disabled={loadingAccion || !motivoAbono.trim()}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingAccion ? 'Revirtiendo…' : 'Revertir abono'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Después del modal de cobro: con el mismo z-index, queda encima. */}
      <AbrirCajaModal
        open={modalCajaOpen}
        onClose={() => setModalCajaOpen(false)}
        onAbierta={() => { setModalCajaOpen(false); setCajaAbierta(true); }}
      />

      {/* Modal revertir pago (admin, caja abierta); el motivo es obligatorio. */}
      {revirtiendoPago && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Revertir pago</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                La nota vuelve a quedar pendiente de cobro por {fmtMonto(nota.precio_total)} y sale
                del corte de la caja abierta. Queda anotado en el Dashboard.
              </p>
            </div>
            <div>
              <label htmlFor="motivo-reversion" className="block text-sm font-medium text-gray-700 mb-1">
                Motivo
              </label>
              <textarea
                id="motivo-reversion"
                value={motivoReversion}
                onChange={e => setMotivoReversion(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Ej. Se cobró la nota equivocada"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition resize-none"
              />
            </div>
            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{errorAccion}</div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setRevirtiendoPago(false); setMotivoReversion(''); setErrorAccion(''); }}
                disabled={loadingAccion}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={revertirPago}
                disabled={loadingAccion || !motivoReversion.trim()}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingAccion ? 'Revirtiendo...' : 'Revertir pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal corregir forma de pago (admin, caja abierta) */}
      {corrigiendoPago && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">Corregir forma de pago</h3>
            </div>
            <p className="text-sm text-gray-500">
              Esta nota está cobrada como{' '}
              <span className="font-semibold text-gray-800">{formaPagoLabel(nota.forma_pago)}</span>.
              Cambiarla mueve el dinero en el <span className="font-semibold text-gray-800">corte de caja</span> de
              hoy y en <span className="font-semibold text-gray-800">Ventas</span>: úsalo solo si se registró mal.
            </p>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Cambiar a:</p>
              <div className="grid grid-cols-3 gap-2">
                {FORMAS_PAGO.filter(opt => opt.v !== nota.forma_pago).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFormaPagoNueva(opt.v)}
                    className={`py-3 px-2 border-2 rounded-xl font-semibold text-sm truncate transition-colors ${
                      formaPagoNueva === opt.v
                        ? 'border-blue bg-light-blue text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setCorrigiendoPago(false); setFormaPagoNueva(''); }}
                disabled={loadingAccion}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={corregirFormaPago}
                disabled={loadingAccion || !formaPagoNueva}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingAccion ? 'Guardando…' : 'Corregir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar entrega (en Por Encargo un admin la puede deshacer). */}
      {confirmFinalizar && (
        <ModalConfirmar
          titulo={esEncargoNota ? 'Entregar nota' : 'Finalizar nota'}
          mensaje={esEncargoNota
            ? `¿Marcar la nota ${nota.folio ?? `#${nota.id}`} como entregada? El cliente ya se llevó su encargo.`
            : `¿Marcar la nota ${nota.folio ?? `#${nota.id}`} como finalizada? Esta acción no se puede deshacer.`}
          onCancelar={() => setConfirmFinalizar(false)}
          onConfirmar={finalizarNota}
          loading={loadingAccion}
          colorBtn="bg-emerald-600 hover:bg-emerald-700"
        />
      )}

      {/* Modal de "Abrir nota": deshace la entrega. */}
      {confirmReabrir && (
        <ModalConfirmar
          titulo="Abrir nota"
          mensaje={`La nota ${nota.folio ?? `#${nota.id}`} vuelve a "Por Entregar", como antes de `
            + 'confirmar la entrega. El cobro y los productos que llevaba no se tocan.'}
          onCancelar={() => { setConfirmReabrir(false); setErrorAccion(''); }}
          onConfirmar={reabrirNota}
          loading={loadingAccion}
          colorBtn="bg-amber-600 hover:bg-amber-700"
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
