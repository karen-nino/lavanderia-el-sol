import { useEffect, useState } from 'react';
import { etiquetaEstadoNota } from '../lib/estadoNota';
import { useParams, useNavigate } from 'react-router-dom';
import Barcode from 'react-barcode';
import { api } from '../lib/api';
import { urlListaNotas } from '../lib/filtrosNotas';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import { etiquetaProducto, tituloProducto, subtituloProducto, ordenProducto } from '../lib/formatoInventario';
import { FORMAS_PAGO, formaPagoLabel } from '../lib/formasPago';
import { formatHora12, formatFechaHora12 } from '../lib/fecha';
import { leerAvisoCobro, limpiarAvisoCobro } from '../lib/avisoCobro';
import { esTerminal, puedeLiquidar, puedeFinalizar, puedeEliminar, eliminarSoloEnEscritorio } from '../lib/accionesNota';
import AbrirCajaModal from '../components/AbrirCajaModal';

// Unidad de venta de un producto de la nota, en texto ("2 botellas" / "3 tapas").
function unidadProdTxt(p) {
  const n = Number(p.cantidad);
  if (p.unidad === 'pieza') return n === 1 ? 'pieza' : 'piezas';
  if (p.unidad === 'botella') {
    if (p.tipo_liquido === 'marca') return n === 1 ? 'unidad' : 'unidades';
    return n === 1 ? 'botella' : 'botellas';
  }
  return n === 1 ? 'tapa' : 'tapas';
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

// Día que se le prometió al cliente, elegido en el paso de Entrega. Antes eran
// horarios (mañana/tarde/noche); las notas viejas con esos valores se muestran
// tal cual, sin etiqueta (2026-09-25).
const TIEMPO_ENTREGA_LABEL = {
  MANANA:   'Mañana',
  DOS_DIAS: 'En 2 días',
  // "Otra" no se enseña como palabra: lo que dice algo es su fecha, que va en
  // la fila de abajo.
  OTRA:     'Otra fecha',
};

const BADGE_PAGO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-red-100 text-red-700'   },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700'  },
};

// El código de barras del folio se apagó a petición de la clienta (2026-09-05),
// pero el bloque se conserva porque puede volver a hacer falta para escanear
// notas: basta poner esto en true para que reaparezca.
const MOSTRAR_CODIGO_BARRAS = false;

// Ciclo de vida de la nota completa. Los pasos "Lavando" y "Secando" se
// expanden con el avance Lavado/Secado de cada carga (ver desglose en el
// render), ya que con varias cargas cada una puede ir en una fase distinta.
const PASOS_ESTADO = [
  { key: 'EN_ESPERA',  label: 'En Espera',    fechaKey: 'EN_ESPERA'  },
  { key: 'LAVANDO',    label: 'Lavando',      fechaKey: 'LAVANDO'    },
  { key: 'SECANDO',    label: 'Secando',      fechaKey: 'SECANDO'    },
  // El label de LISTA lo pone etiquetaEstadoLista(): en Autoservicio esa nota
  // no espera una entrega, espera su cobro.
  { key: 'LISTA',      label: 'Por Entregar', fechaKey: 'LISTA'      },
  { key: 'FINALIZADA', label: 'Finalizada',   fechaKey: 'FINALIZADA' },
];

// Pasos que se dibujan para esta nota. En autoservicio el cliente se lleva su
// ropa él mismo: la nota PAGADA se finaliza sola al terminar sus cargas y nunca
// pasa por "Por Entregar", así que ese paso sobra. Se conserva en la nota de
// autoservicio que sí lo vive: la que debe y espera ahí su cobro.
function pasosDeNota(nota) {
  // La venta de Productos (mig. 112) nace finalizada: no hay lavado, ni secado,
  // ni nada que entregar después. Su línea de tiempo es un solo punto; dibujar
  // los cinco pasos contaría un proceso que esa nota nunca vivió.
  if (nota.tipo_servicio === 'PRODUCTOS') return PASOS_ESTADO.filter(p => p.key === 'FINALIZADA');
  if (nota.tipo_servicio !== 'AUTOSERVICIO') return PASOS_ESTADO;
  const porEntregar = ['LISTA', 'PAGADA'].includes(nota.estado)
    || (nota.historial_estados ?? []).some(h => h.estado === 'LISTA')
    // …y el que todavía DEBE va a pasar por ahí aunque aún no haya llegado:
    // sin el cobro no se cierra solo, espera en "Por Entregar" a que lo
    // liquiden (2026-09-23). Saltarse el paso prometía un final que esa nota
    // no iba a tener.
    || nota.estado_pago === 'PENDIENTE';
  // "Lavando" y "Secando" solo si esta nota los va a vivir. En Autoservicio hay
  // notas de puro lavado y otras de puro secado, y dibujar el paso que falta
  // prometía una fase que nunca iba a llegar (2026-09-25). Cuenta la máquina
  // puesta, la que ya se usó y la que se eligió al hacer la nota y todavía no
  // se asigna; y si la nota YA pasó por esa fase, el paso se queda aunque hoy
  // no le quede ninguna máquina de ese tipo.
  const tieneFase = (estado, campos) =>
    nota.estado === estado
    || (nota.historial_estados ?? []).some(h => h.estado === estado)
    || (nota.cargas ?? []).some(cg => campos.some(c => cg[c]));
  const conLavado = tieneFase('LAVANDO', ['lavadora_id', 'lavadora_usada_id', 'lavadora_tipo_previsto']);
  const conSecado = tieneFase('SECANDO', ['secadora_id', 'secadora_usada_id', 'secadora_tipo_previsto']);
  const fuera = new Set();
  if (!porEntregar) fuera.add('LISTA');
  if (!conLavado)   fuera.add('LAVANDO');
  if (!conSecado)   fuera.add('SECANDO');
  return PASOS_ESTADO.filter(p => !fuera.has(p.key));
}

// Índice del paso ACTUAL dentro de los pasos que se dibujan.
function progresoPasos(nota, pasos) {
  const clave = nota.estado === 'PAGADA' ? 'LISTA' : nota.estado;
  const i = pasos.findIndex(p => p.key === clave);
  return i === -1 ? 0 : i;
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
  return formatFechaHora12(iso);
}

function fmtHora(iso) {
  if (!iso) return '—';
  return formatHora12(iso);
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

// Modal de abono (mig. 121): un pago PARCIAL de la nota. Pide cuánto y con qué
// forma, y no deja pasarse de lo que falta — ese dinero la nota no lo debe. El
// monto arranca en 0: lo teclea quien cobra, con el efectivo en la mano.
function ModalAbonar({ saldo, folio, monto, onMonto, formaPago, onFormaPago,
                       onCancelar, onConfirmar, loading, error, cajaAbierta, onAbrirCaja }) {
  const importe = Number(monto);
  const valido = Number.isFinite(importe) && importe > 0 && importe <= saldo + 1e-9;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">Abonar a la nota</h3>
          <p className="text-sm text-gray-500">Nota {folio}</p>
        </div>

        <div className="rounded-2xl bg-light-blue border-2 border-blue/30 px-5 py-4 text-center">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Falta por cobrar</p>
          <p className="text-4xl font-bold text-dark-blue leading-tight mt-1">{fmtMonto(saldo)}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        {cajaAbierta === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">La caja del día no está abierta</p>
            <p className="mt-0.5 text-sm text-amber-800">
              Puedes abonar, pero este dinero no va a aparecer en el corte de hoy.
            </p>
            <button
              type="button"
              onClick={onAbrirCaja}
              className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors"
            >
              Abrir caja
            </button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900">¿Cuánto abona?</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
            <input
              type="number" min="0" step="any" max={saldo}
              value={monto}
              onChange={e => onMonto(e.target.value)}
              className="w-full pl-8 pr-4 py-3.5 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue focus:border-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          {Number.isFinite(importe) && importe > saldo + 1e-9 && (
            <p className="text-xs text-red-600">
              La nota solo debe {fmtMonto(saldo)}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Método de pago:</p>
          <div className="grid grid-cols-3 gap-3">
            {FORMAS_PAGO.map(opt => {
              const selected = formaPago === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onFormaPago(opt.v)}
                  className={`py-4 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                    selected
                      ? 'border-blue bg-light-blue text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            onClick={onCancelar}
            disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={loading || !valido || !formaPago}
            className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
          >
            {loading ? 'Registrando...' : 'Abonar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal de cobro: pide la forma de pago además de confirmar. Sin este dato el
// corte de caja no distingue el dinero del cajón de transferencias y tarjetas.
//
// `cajaAbierta === false` avisa que el cobro se va a quedar fuera del corte del
// día. El aviso vivía solo en Nueva Nota, que era donde se cobraba el
// autoservicio; desde que el cobro se hace aquí (2026-09-23) tenía que venirse
// con él, o el dinero se salía del corte sin que nadie se enterara.
function ModalLiquidar({ monto, folio, formaPago, onFormaPago, onCancelar, onConfirmar, loading,
                         cajaAbierta, onAbrirCaja, abonado = 0, total }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">Liquidar nota</h3>
          <p className="text-sm text-gray-500">Nota {folio}</p>
        </div>

        {/* El monto es lo que el empleado tiene que cobrar: va en grande y
            aparte, no escondido dentro del texto. */}
        {/* Con abonos, lo que hay que cobrar NO es el total de la nota: es lo
            que falta. El total se dice debajo para que se entienda el número
            grande (mig. 121). */}
        <div className="rounded-2xl bg-light-blue border-2 border-blue/30 px-5 py-4 text-center">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            {abonado > 0 ? 'Falta por cobrar' : 'Total'}
          </p>
          <p className="text-4xl font-bold text-dark-blue leading-tight mt-1">{monto}</p>
          {abonado > 0 && (
            <p className="text-xs text-blue-700 mt-1">
              Ya abonó {fmtMonto(abonado)} de {fmtMonto(total)}
            </p>
          )}
        </div>

        {cajaAbierta === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">La caja del día no está abierta</p>
            <p className="mt-0.5 text-sm text-amber-800">
              Puedes cobrar, pero este dinero no va a aparecer en el corte de hoy.
            </p>
            <button
              type="button"
              onClick={onAbrirCaja}
              className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors"
            >
              Abrir caja
            </button>
          </div>
        )}

        {/* Mismos botones que el cobro de Nueva Nota: el empleado elige la
            forma de pago en el mismo gesto en las dos pantallas. */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">Método de pago:</p>
          <div className="grid grid-cols-3 gap-3">
            {FORMAS_PAGO.map(opt => {
              const selected = formaPago === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onFormaPago(opt.v)}
                  className={`py-4 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                    selected
                      ? 'border-blue bg-light-blue text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            onClick={onCancelar}
            disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={loading || !formaPago}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors"
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
  const [motivoCancelarOpen, setMotivoCancelarOpen] = useState(false);
  const [motivoCancelar,   setMotivoCancelar]   = useState('');
  const [confirmFinalizar,  setConfirmFinalizar]  = useState(false);
  // Deshacer la entrega (solo admin): la nota vuelve a Por Entregar.
  const [confirmReabrir,    setConfirmReabrir]    = useState(false);
  const [confirmLiquidar,  setConfirmLiquidar]  = useState(false);
  const [formaPagoSel,     setFormaPagoSel]     = useState('');
  // Abono: pago parcial de la nota (mig. 121).
  const [abonarOpen,       setAbonarOpen]       = useState(false);
  const [abonoMonto,       setAbonoMonto]       = useState('');
  const [abonoForma,       setAbonoForma]       = useState('');
  const [confirmRevertirAbono, setConfirmRevertirAbono] = useState(null);
  const [motivoAbono,      setMotivoAbono]      = useState('');
  const [corrigiendoPago,  setCorrigiendoPago]  = useState(false);
  // Reversión del cobro (solo admin, caja aún abierta): el motivo es
  // obligatorio, así que el modal lleva su propio texto.
  const [revirtiendoPago,  setRevirtiendoPago]  = useState(false);
  const [motivoReversion,  setMotivoReversion]  = useState('');
  const [formaPagoNueva,   setFormaPagoNueva]   = useState('');
  const [confirmEliminar,  setConfirmEliminar]  = useState(false);
  // Un cambio hecho en Salidas movió el total de esta nota y dejó sin efecto su
  // cobro (el backend la devolvió a PENDIENTE). Aquí, junto al estado de pago y
  // al botón de cobrar, se explica cuánto falta cobrar o devolver.
  const [avisoCobro, setAvisoCobro] = useState(() => leerAvisoCobro(id));
  // ¿Hay caja abierta? Solo se pregunta al ir a cobrar, que es cuando importa.
  // null = todavía no se sabe (o falló la consulta): entonces no se avisa nada.
  const [cajaAbierta,   setCajaAbierta]   = useState(null);
  const [modalCajaOpen, setModalCajaOpen] = useState(false);

  // Abre el modal de cobro y, de paso, mira si hay caja abierta para poder
  // avisar que ese dinero se quedaría fuera del corte del día.
  function abrirLiquidar() {
    setConfirmLiquidar(true);
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null));
  }

  // Deshace la entrega: la nota finalizada vuelve a "Por Entregar", como antes
  // de confirmarla. Se relee del servidor porque también devuelve al inventario
  // los productos que la entrega había dado por vendidos.
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

  // Abonar: el monto arranca en 0 y lo teclea quien cobra (2026-09-25) — el
  // abono es justo lo que el cliente trae, no un número que la app suponga.
  // Avisa igual que el cobro si la caja del día no está abierta.
  function abrirAbonar() {
    setErrorAccion('');
    setAbonoMonto('0');
    setAbonoForma('');
    setAbonarOpen(true);
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null));
  }

  // Registra el abono y vuelve a leer la nota: el abono puede haberla dejado
  // pagada (y a un Autoservicio ya terminado, finalizada), así que el estado,
  // los botones y la línea de tiempo se releen del servidor.
  async function abonarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      await api.post(`/notas/${id}/abonos`, {
        monto: Number(abonoMonto), forma_pago: abonoForma,
      });
      const fresca = await api.get(`/notas/${id}`);
      setNota(fresca);
      setAbonarOpen(false);
      setAbonoMonto('');
      setAbonoForma('');
    } catch (err) {
      // El motivo se queda dentro del modal: el aviso de la página está arriba
      // del todo y aquí no se vería.
      setErrorAccion(err.message);
    } finally {
      setLoadingAccion(false);
    }
  }

  // Deshace un abono mal capturado (solo admin, con motivo). Si ese abono había
  // dejado la nota pagada, vuelve a deber.
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
        // El aviso solo tiene sentido mientras la nota siga sin cobrarse.
        if (data?.estado_pago !== 'PENDIENTE') {
          limpiarAvisoCobro(id);
          setAvisoCobro(null);
        }
      })
      .catch(err => { if (activo) setError(err.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

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

  // Deshace el cobro de una nota (PAGADO → PENDIENTE) para poder cancelarla o
  // volver a cobrarla bien. El servidor solo lo permite a un admin, con motivo
  // y mientras la caja donde entró ese dinero siga abierta; además lo deja
  // anotado en la campana del Dashboard.
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
      // `pago_reversible` lo calcula el servidor: ya sin cobro, deja de aplicar.
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

  // Corrige la forma de pago de una nota YA cobrada (el empleado registró
  // efectivo y el cliente pagó por transferencia). El servidor solo lo permite
  // mientras la caja donde se cobró siga abierta; ahí el corte y Ventas se
  // recalculan solos.
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

  // Liquidar = cobrar la nota (estado_pago → PAGADO). Solo entonces se puede
  // finalizar.
  //
  // Normalmente no cambia el estado (sigue LISTA/Por Entregar), pero un
  // Autoservicio que ya terminó sus cargas se FINALIZA solo al cobrarlo: el
  // cliente se llevó su ropa y no hay nada que entregar (2026-09-23). Por eso
  // se vuelve a leer la nota completa en vez de parchar el pago: así el estado,
  // la línea de tiempo y los botones cuentan lo mismo que el servidor.
  async function liquidarNota() {
    setLoadingAccion(true);
    setErrorAccion('');
    try {
      const updated = await api.patch(`/notas/${id}/estado-pago`, {
        estado_pago: 'PAGADO',
        forma_pago: formaPagoSel,
      });
      const fresca = await api.get(`/notas/${id}`).catch(() => null);
      setNota(prev => fresca ?? ({
        ...prev,
        estado_pago: updated.estado_pago,
        forma_pago:  updated.forma_pago,
        estado:      updated.estado ?? prev.estado,
      }));
      // Ya se cobró por el importe nuevo: el aviso deja de aplicar.
      limpiarAvisoCobro(id);
      setAvisoCobro(null);
      setConfirmLiquidar(false);
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmLiquidar(false);
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
  // Cancelar: solo admin y solo mientras la nota NO esté cobrada. Después del
  // cobro habría que devolver dinero, y eso descuadra el corte del día; para
  // eso está la reversión de pago.
  const puedeCancelar = esAdmin
    && !['CANCELADA', 'PAGADA'].includes(nota.estado)
    && nota.estado_pago !== 'PAGADO';
  // Cobrar se puede desde que la nota existe, no solo cuando ya está lista: en
  // Por Encargo el cliente suele pagar al dejar la ropa, y hasta hace poco el
  // botón no aparecía hasta el final, cuando ese dinero ya se había cobrado en
  // la vida real y no en el sistema. El servidor lo permite en cualquier estado
  // menos CANCELADA.
  //
  // Va en una variable porque sale en los DOS bloques de acciones: el de la
  // nota viva y el de la nota ya cerrada — una FINALIZADA a la que le
  // revirtieron el pago vuelve a deber y también hay que poder cobrarla.
  // En Por Encargo la ropa se entrega en mostrador, así que el último paso se
  // llama ENTREGAR y un admin puede deshacerlo (2026-09-25).
  const esEncargoNota = nota.tipo_servicio === 'POR_ENCARGO';
  // Lo abonado y lo que falta (mig. 121). El servidor los manda calculados; con
  // notas viejas o sin abonos, `saldo` es el total de la nota.
  const abonosNota = nota.abonos ?? [];
  const abonadoNota = Number(nota.abonado ?? 0);
  const saldoNota = Number(nota.saldo ?? nota.precio_total ?? 0);
  // Abonar es para Por Encargo, que es donde el cliente adelanta una parte al
  // dejar la ropa. Lo puede hacer cualquiera que atienda el mostrador, mientras
  // la nota siga debiendo y no esté cancelada.
  const botonAbonar = nota.tipo_servicio === 'POR_ENCARGO'
    && nota.estado_pago === 'PENDIENTE'
    && nota.estado !== 'CANCELADA'
    && saldoNota > 0 && (
    <button
      onClick={abrirAbonar}
      disabled={loadingAccion}
      className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Abonar
    </button>
  );
  const botonLiquidar = puedeLiquidar(nota) && (
    <button
      onClick={abrirLiquidar}
      disabled={loadingAccion}
      className="flex items-center gap-1.5 px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
    >
      Liquidar
    </button>
  );
  const badgeTipoServicio    = BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? BADGE_TIPO_SERVICIO.AUTOSERVICIO;
  const badgePago     = BADGE_PAGO[nota.estado_pago];
  const barcodeValue  = nota.folio ?? String(nota.id);
  const pasos         = pasosDeNota(nota);
  const pasoActual    = progresoPasos(nota, pasos);
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
            {/* El folio completo (0043-040926): su consecutivo y la fecha. En la
                lista de notas solo se ve el consecutivo, así que este es el
                único lugar de la app —fuera del ticket— donde se lee entero. */}
            <p className="text-sm text-gray-500 leading-tight truncate">
              {nota.folio ?? `#${nota.id}`}
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
            {/* El mismo recibo que la sección Ticket de Ajustes (Lucide "receipt"). */}
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
      <div className="max-w-2xl mx-auto px-6 md:p-6 py-6 space-y-6">

      {/* Error de acción */}
      {errorAccion && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorAccion}
        </div>
      )}

      {/* Un cambio hecho en Salidas movió el total y dejó sin efecto el cobro:
          la nota volvió a Pendiente y hay que cobrarla por el importe nuevo. */}
      {avisoCobro && nota.estado_pago === 'PENDIENTE' && (
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

      {/* Botones de acción */}
      {!terminal && (
        <div className="flex flex-wrap gap-2">
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
            onClick={() => navigate(`/notas/${id}/salidas`)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Salidas
          </button>
          {botonAbonar}
          {botonLiquidar}
          {/* Último paso, y sigue exigiendo el cobro: una nota pendiente no se
              puede dar por entregada. En Por Encargo el botón dice ENTREGAR,
              que es lo que de verdad se hace con la ropa (2026-09-25). */}
          {puedeFinalizar(nota) && (
            <button
              onClick={() => setConfirmFinalizar(true)}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {esEncargoNota ? 'Entregar' : 'Finalizar'}
            </button>
          )}
          {/* Mientras la nota vive, Eliminar solo se ve donde se apunta con mouse
              o trackpad (`pointer: fine`). Con el dedo está pegado a Cancelar y
              borrar no se deshace; por ancho no salía, porque una tablet grande
              mide lo mismo que una laptop. En táctil el camino es cancelar. */}
          {puedeEliminar(nota, esAdmin) && (
            <button
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
              className={`${eliminarSoloEnEscritorio(nota) ? 'hidden pointer-fine:flex' : 'flex'} items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors`}
            >
              Eliminar
            </button>
          )}
        </div>
      )}
      {/* Ya cerrada, el botón se ve en los dos tamaños. Y si quedó debiendo
          —le revirtieron el pago—, sigue habiendo por dónde cobrarla. */}
      {terminal && (
        <div className="flex flex-wrap gap-2">
          {botonAbonar}
          {botonLiquidar}
          {/* Deshacer la entrega: la nota vuelve a Por Entregar, como antes de
              confirmarla. Para el error de mostrador —se entregó la nota
              equivocada—, así que es de admin (2026-09-25). */}
          {esAdmin && esEncargoNota && nota.estado === 'FINALIZADA' && (
            <button
              onClick={() => { setErrorAccion(''); setConfirmReabrir(true); }}
              disabled={loadingAccion}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Abrir nota
            </button>
          )}
          {puedeEliminar(nota, esAdmin) && (
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

      {/* Cuánto falta cobrar (o cuánto se cobró ya). Va arriba y en grande
          porque es el dato que el empleado necesita al entregar la ropa; en el
          bloque de Detalles el total quedaba como una fila más entre el ID y la
          fecha. En notas canceladas no aplica: no hay nada que cobrar. */}
      {nota.estado !== 'CANCELADA' && (
        nota.estado_pago === 'PENDIENTE' ? (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pendiente de cobro</p>
              {/* Con abonos, lo que falta NO es el total de la nota: el monto
                  grande es el saldo y debajo se dice de cuánto viene. */}
              <p className="text-3xl font-bold text-amber-900 leading-tight mt-0.5">{fmtMonto(saldoNota)}</p>
              {abonadoNota > 0 && (
                <p className="text-xs text-amber-800 mt-1">
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
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                  Cobrada{nota.forma_pago ? ` · ${formaPagoLabel(nota.forma_pago)}` : ''}
                </p>
                <p className="text-xl font-bold text-emerald-900 leading-tight mt-0.5">{fmtMonto(nota.precio_total)}</p>
              </div>
              <svg className="w-7 h-7 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {/* Corregir la forma de pago solo mientras la caja donde se cobró
                siga abierta: el servidor manda ese permiso ya calculado. */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {esAdmin && nota.forma_pago_editable && (
                <button
                  type="button"
                  onClick={() => { setFormaPagoNueva(''); setCorrigiendoPago(true); }}
                  className="text-xs font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
                >
                  Corregir forma de pago
                </button>
              )}
              {/* Revertir deja la nota pendiente de cobro: desde ahí se puede
                  cancelar o volver a cobrar con el importe correcto. */}
              {esAdmin && nota.pago_reversible && !terminal && (
                <button
                  type="button"
                  onClick={() => { setMotivoReversion(''); setErrorAccion(''); setRevirtiendoPago(true); }}
                  className="text-xs font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
                >
                  Revertir pago
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* Código de barras: apagado, no borrado (ver MOSTRAR_CODIGO_BARRAS). */}
      {MOSTRAR_CODIGO_BARRAS && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex justify-center shadow-sm">
          <Barcode value={barcodeValue} height={50} fontSize={12} />
        </div>
      )}

      {/* Información de entrega (datos del paso de Entrega) — solo Por Encargo.
          Ni el autoservicio ni la venta de mostrador dejan nada a cargo del
          negocio: el cliente se lo lleva en el momento. */}
      {!['AUTOSERVICIO', 'PRODUCTOS'].includes(nota.tipo_servicio) && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Entrega</h2>
          </div>
          <div className="px-4">
            <FilaDetalle label="Fecha de entrega">
              {nota.fecha_entrega ? fmtFecha(nota.fecha_entrega) : <span className="text-gray-400">—</span>}
            </FilaDetalle>
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
            {nota.tamano && <span className="ml-2 text-xs text-gray-500 capitalize">{nota.tamano}</span>}
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
          {/* La venta de mostrador no recibe ropa: su tipo_prenda es solo el
              valor por defecto de la columna, no un dato de la nota. */}
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
          <FilaDetalle label="Estado de pago">
            {badgePago
              ? <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgePago.cls}`}>{badgePago.label}</span>
              : <span className="text-gray-400">—</span>}
          </FilaDetalle>
          {nota.forma_pago && (
            <FilaDetalle label="Forma de pago">
              <span className="text-gray-700">{formaPagoLabel(nota.forma_pago)}</span>
            </FilaDetalle>
          )}
          {/* Rastro de las correcciones (mig. 102): es dinero que se movió de
              columna en el corte, así que se deja a la vista quién lo cambió. */}
          {(nota.historial_forma_pago ?? []).length > 0 && (
            <FilaDetalle label="Correcciones de pago">
              <div className="space-y-1.5">
                {nota.historial_forma_pago.map((h, i) => (
                  <div key={i} className="text-xs text-gray-500">
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
          {/* Abonos (mig. 121): cada pago parcial con su forma, quién lo tomó y
              cuándo. Los revertidos se siguen viendo, tachados: el rastro del
              dinero no se borra. */}
          {abonosNota.length > 0 && (
            <FilaDetalle label="Abonos">
              <div className="space-y-2">
                {abonosNota.map(ab => {
                  const revertido = ab.revertido_at != null;
                  return (
                    <div key={ab.id} className="text-xs text-gray-500">
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
                          className="mt-0.5 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                        >
                          Revertir abono
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="text-xs font-semibold text-gray-700 pt-1 border-t border-gray-100">
                  Abonado {fmtMonto(abonadoNota)} · Falta {fmtMonto(saldoNota)}
                </div>
              </div>
            </FilaDetalle>
          )}
          {(nota.cargas ?? []).length > 0 && (
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
                  // Una línea POR PASADA (mig. 114): una carga que se relavó
                  // lista su lavadora dos veces, aunque sea la misma máquina.
                  // El importe va en la PRIMERA pasada de cada hueco, que es la
                  // que se cobró (`precio_lavadora` / `precio_secadora`); las
                  // vueltas siguientes van sin cobro, así que van sin cifra.
                  // Repetirlo haría parecer que se cobraron dos lavados.
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
                      // La que sigue puesta muestra su estado en vivo; una pasada
                      // ya cerrada cumplió su parte (verde).
                      estado: u.actual ? estadoVivo : 'terminado',
                      precio: esPrimera
                        ? Number(esLav ? cg.precio_lavadora : cg.precio_secadora)
                        : null,
                    };
                  });
                  // Por Encargo: slots con TIPO elegido pero sin máquina física
                  // todavía (se asignan en Salidas). Se muestran como "sin asignar".
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
                  const totalCarga = Number(cg.precio_lavadora) + Number(cg.precio_secadora)
                    + Number(cg.ajuste ?? 0) + totalProds;
                  // Autoservicio no maneja prenda/tela/tamaño: se omite esa línea.
                  const atributos = nota.tipo_servicio === 'AUTOSERVICIO' ? [] : [
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
                      {maquinasCarga.length === 0 && slotsPrevistos.length === 0 ? (
                        <span className="text-sm text-gray-400 italic">Sin máquinas</span>
                      ) : (
                        maquinasCarga.map((m, i) => {
                          const cfg = BADGE_MAQUINA_ESTADO[m.estado];
                          // El tamaño (M/J) solo aplica a lavadoras; la secadora
                          // es de un solo tamaño, así que va solo con su nombre.
                          const tamanoLabel = m.tipo === 'secadora' ? null : MAQUINA_TIPO_LABEL[m.tipo];
                          const tipoLabel = tamanoLabel ? (TAMANO_ABBR[tamanoLabel] ?? tamanoLabel) : null;
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
                              {/* Sin importe: es una pasada anterior del mismo
                                  hueco y no se cobró aparte. */}
                              {m.precio != null && (
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
                        <p className="text-xs text-gray-500">{atributos.join(' · ')}</p>
                      )}
                      {prods.map(p => (
                        <p key={p.id} className="text-xs text-gray-500">
                          {p.es_por_tapa && Number(p.subtotal) === 0
                            ? <>{etiquetaProducto(p)} · {p.cantidad} {unidadProdTxt(p)} · <span className="text-green-700 font-medium">Incluido</span></>
                            : <>{etiquetaProducto(p)} · {p.cantidad} {unidadProdTxt(p)} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}</>}
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
          <FilaDetalle label="Ajuste">
            {nota.ajuste != null ? fmtMonto(nota.ajuste) : '—'}
          </FilaDetalle>
          <FilaDetalle label="Precio total">
            <span className="font-semibold text-gray-900">{fmtMonto(nota.precio_total)}</span>
          </FilaDetalle>
        </div>
      </div>

      {/* Productos. Solo en la venta de mostrador (servicio Productos), que no
          pasa por Salidas y cuyos productos SON la nota entera. En Autoservicio
          y Por Encargo los productos se ven y se manejan en Salidas
          (2026-09-25): ahí es donde se agregan y se quitan. */}
      {nota.tipo_servicio === 'PRODUCTOS' && (
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
            {[...(nota.productos || [])].sort((a, b) => ordenProducto(a) - ordenProducto(b)).map(p => {
              const incluido = p.es_por_tapa && Number(p.subtotal) === 0;
              return (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{tituloProducto(p)}</p>
                  <p className="text-xs text-gray-400">
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
                <p className="text-xs text-gray-400">
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
                        {etiquetaEstadoNota(paso.key, nota.tipo_servicio, paso.label)}
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

      {/* Modal del motivo de cancelación */}
      {motivoCancelarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
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

      {/* Modal confirmar liquidación (cobro) */}
      {abonarOpen && (
        <ModalAbonar
          folio={nota.folio ?? `#${nota.id}`}
          saldo={saldoNota}
          monto={abonoMonto}
          onMonto={setAbonoMonto}
          formaPago={abonoForma}
          onFormaPago={setAbonoForma}
          onCancelar={() => { setAbonarOpen(false); setErrorAccion(''); }}
          onConfirmar={abonarNota}
          loading={loadingAccion}
          error={errorAccion}
          cajaAbierta={cajaAbierta}
          onAbrirCaja={() => setModalCajaOpen(true)}
        />
      )}

      {confirmRevertirAbono && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
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

      {confirmLiquidar && (
        <ModalLiquidar
          folio={nota.folio ?? `#${nota.id}`}
          monto={fmtMonto(saldoNota)}
          abonado={abonadoNota}
          total={nota.precio_total}
          formaPago={formaPagoSel}
          onFormaPago={setFormaPagoSel}
          onCancelar={() => { setConfirmLiquidar(false); setFormaPagoSel(''); }}
          onConfirmar={liquidarNota}
          loading={loadingAccion}
          cajaAbierta={cajaAbierta}
          onAbrirCaja={() => setModalCajaOpen(true)}
        />
      )}

      {/* Va DESPUÉS del modal de cobro: comparten z-index, así que el último
          en el DOM es el que queda encima. */}
      <AbrirCajaModal
        open={modalCajaOpen}
        onClose={() => setModalCajaOpen(false)}
        onAbierta={() => { setModalCajaOpen(false); setCajaAbierta(true); }}
      />

      {/* Modal revertir pago (solo admin, caja aún abierta). El motivo es
          obligatorio: sin él el botón de confirmar queda apagado. */}
      {revirtiendoPago && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
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

      {/* Modal corregir forma de pago (solo admin, caja aún abierta) */}
      {corrigiendoPago && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
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

      {/* Modal confirmar entrega. En Por Encargo un admin puede deshacerla
          después con "Abrir nota", así que ya no se promete que no se pueda. */}
      {confirmFinalizar && (
        <ModalConfirmar
          titulo={esEncargoNota ? 'Entregar nota' : 'Finalizar nota'}
          mensaje={esEncargoNota
            ? `¿Marcar la nota ${nota.folio ?? `#${nota.id}`} como entregada? El cliente ya se llevó su ropa.`
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
            + 'confirmar la entrega. Los productos que llevaba vuelven a quedar apartados para ella. '
            + 'El cobro no se toca.'}
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
