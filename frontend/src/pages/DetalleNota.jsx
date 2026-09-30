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
import { armarMensajeWhatsapp, hayMensajeWhatsapp, telefonoWhatsapp } from '../lib/mensajeWhatsapp';

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

// Ciclo de vida de la nota completa.
//
// LAVANDO y SECANDO van en UN SOLO paso, "En proceso" (2026-09-28). Son dos
// estados en la base —y así se siguen guardando—, pero en la línea de tiempo
// contaban una secuencia que el mostrador no vive: las máquinas van
// independientes, una carga puede estar secando mientras otra lava, y el paso
// que faltaba se quedaba en gris como si nunca hubiera pasado. Lo que de verdad
// dice en qué va cada carga es el desglose de abajo (Lavado/Secado por carga),
// que se conserva entero.
//
// `estados` son los estados de la nota que caen en ese paso; el paso se cuenta
// como actual cuando el de la nota es cualquiera de ellos, y su fecha es la
// PRIMERA de las que tenga (cuándo empezó a procesarse).
// La tarjeta "Estado" —la línea de tiempo de la nota— está ESCONDIDA mientras
// el negocio decide si la mantiene (2026-09-28). Se enseña otra vez poniendo
// esto en true; la tarjeta sigue ahí, entera.
const MOSTRAR_ESTADO_NOTA = false;

const PASOS_ESTADO = [
  { key: 'EN_ESPERA',  label: 'En Espera',    estados: ['EN_ESPERA'] },
  { key: 'PROCESO',    label: 'En proceso',   estados: ['LAVANDO', 'SECANDO'] },
  // El label de LISTA lo pone etiquetaEstadoLista(): en Autoservicio esa nota
  // no espera una entrega, espera su cobro.
  { key: 'LISTA',      label: 'Por Entregar', estados: ['LISTA'] },
  { key: 'FINALIZADA', label: 'Finalizada',   estados: ['FINALIZADA'] },
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
  // Ahora es un solo paso: sobra únicamente si la nota no lava NI seca.
  if (!conLavado && !conSecado) fuera.add('PROCESO');
  return PASOS_ESTADO.filter(p => !fuera.has(p.key));
}

// Índice del paso ACTUAL dentro de los pasos que se dibujan. El estado de la
// nota puede caer en un paso que agrupa varios (LAVANDO y SECANDO son los dos
// "En proceso"), así que se busca por la lista de estados del paso.
function progresoPasos(nota, pasos) {
  const clave = nota.estado === 'PAGADA' ? 'LISTA' : nota.estado;
  const i = pasos.findIndex(p => p.estados.includes(clave));
  return i === -1 ? 0 : i;
}

// Cuándo empezó este paso: la primera fecha de los estados que agrupa. "En
// proceso" empieza cuando la nota empezó a lavar —o a secar, si arrancó por
// ahí—, no cuando cambió de una fase a la otra.
function fechaDePaso(paso, fechaPorEstado) {
  const fechas = paso.estados.map(e => fechaPorEstado[e]).filter(Boolean);
  return fechas.length > 0 ? fechas.sort()[0] : undefined;
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

// Acción en redondo: un círculo de color con su ícono y la palabra debajo
// (2026-09-26, referencia en `info/`). Es el patrón de las apps de banco, y
// aquí gana porque en el teléfono el ícono se reconoce de un vistazo mientras
// que una hilera de píldoras de colores hay que leerla entera.
//
// El botón entero es el área que se toca —círculo y palabra—, no solo el
// círculo: con el dedo, 44 px de círculo suelto se falla.
function AccionCircular({ icono, label, onClick, color, disabled = false, title, className = 'flex' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // `className` trae cómo se MUESTRA (Eliminar se esconde en táctil), por
      // eso el `flex` va ahí y no fijo: si no, no habría manera de ocultarlo.
      className={`${className} flex-col items-center gap-1.5 w-20 disabled:opacity-60 disabled:cursor-not-allowed group`}
    >
      <span className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors ${color}`}>
        {icono}
      </span>
      {/* Versalitas apretadas contra el círculo: en mayúsculas y con aire
          entre letras la palabra se lee como rótulo del ícono y no como un
          botón de texto más (2026-09-26). */}
      <span className="text-[12px] font-bold uppercase tracking-wider text-gray-700 text-center leading-tight">
        {label}
      </span>
    </button>
  );
}

// Los íconos de esas acciones, en trazo blanco sobre el círculo.
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

const IconoCancelar = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Círculo tachado: la nota se anula. */}
    <circle cx="12" cy="12" r="9" strokeWidth={2} />
    <path strokeLinecap="round" strokeWidth={2} d="M5.6 5.6l12.8 12.8" />
  </svg>
);

const IconoProcesado = (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {/* Paquete cerrado con su cinta: la ropa ya doblada y empacada. */}
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 8.5L12 4l9 4.5v7L12 20l-9-4.5v-7z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8.5L12 13l9-4.5M12 13v7" />
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

// Modal ÚNICO de cobro (2026-09-26). Antes eran dos —"Abonar" y "Liquidar"—,
// y en el mostrador son el mismo gesto: recibir dinero. La única diferencia es
// si lo que trae el cliente alcanza para todo, y eso lo dice el importe, no un
// botón distinto. Aquí viene puesto el saldo completo, que es el caso normal
// (liquidar de un toque); bajarlo deja la nota abonada y debiendo el resto.
//
// Con saldo 0 no hay importe que teclear —no se puede abonar $0— y el modal se
// queda en confirmar el cobro y su forma, como hacía Liquidar.
//
// `cajaAbierta === false` avisa que el dinero se va a quedar fuera del corte
// del día. El aviso vivía solo en Nueva Nota, que era donde se cobraba el
// autoservicio; desde que el cobro se hace aquí (2026-09-23) se vino con él, o
// el dinero se salía del corte sin que nadie se enterara.
function ModalCobrar({ saldo, folio, monto, onMonto, formaPago, onFormaPago,
                       onCancelar, onConfirmar, loading, error, cajaAbierta, onAbrirCaja,
                       abonado = 0, total }) {
  const sinSaldo = saldo <= 1e-9;
  const importe = Number(monto);
  const montoOk = Number.isFinite(importe) && importe > 0 && importe <= saldo + 1e-9;
  const valido = sinSaldo || montoOk;
  // Lo que pasa al confirmar, dicho antes de confirmar: es lo que antes
  // elegías al escoger entre los dos botones.
  const liquida = sinSaldo || (montoOk && importe >= saldo - 1e-9);
  const restante = montoOk ? saldo - importe : 0;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-bold text-gray-900">Cobrar nota</h3>
          <p className="text-sm text-gray-500">Nota {folio}</p>
        </div>

        {/* El monto es lo que el empleado tiene que cobrar: va en grande y
            aparte, no escondido dentro del texto. Con abonos no es el total de
            la nota sino lo que falta; el total se dice debajo para que se
            entienda el número grande (mig. 121). */}
        <div className="rounded-2xl bg-light-blue border-2 border-blue/30 px-5 py-4 text-center">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            {abonado > 0 ? 'Falta por cobrar' : 'Total'}
          </p>
          <p className="text-4xl font-bold text-dark-blue leading-tight mt-1">{fmtMonto(saldo)}</p>
          {abonado > 0 && (
            <p className="text-xs text-blue-700 mt-1">
              Ya abonó {fmtMonto(abonado)} de {fmtMonto(total)}
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

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

        {!sinSaldo && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900">¿Cuánto recibes?</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
              <input
                type="number" min="0" step="any" max={saldo}
                value={monto}
                onChange={e => onMonto(e.target.value)}
                className="w-full pl-8 pr-4 py-3.5 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue focus:border-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            {Number.isFinite(importe) && importe > saldo + 1e-9 ? (
              <p className="text-xs text-red-600">La nota solo debe {fmtMonto(saldo)}.</p>
            ) : montoOk && !liquida ? (
              <p className="text-xs text-gray-500">
                Queda abonada: le faltarían {fmtMonto(restante)} por pagar.
              </p>
            ) : montoOk ? (
              <p className="text-xs text-gray-500">Con esto la nota queda liquidada.</p>
            ) : null}
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
            disabled={loading || !valido || !formaPago}
            className="flex-1 bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Procesando...' : liquida ? 'Liquidar' : 'Abonar'}
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
  // Aviso de "ya está procesada" por WhatsApp (mig. 124). La plantilla la
  // escribe el negocio en Ajustes; aquí solo se rellena y se manda.
  const [procesadoOpen,    setProcesadoOpen]    = useState(false);
  const [plantillaWa,      setPlantillaWa]      = useState('');

  // Cobro: uno solo para liquidar y para abonar (2026-09-26). Lo que se cobra
  // lo dice el importe, no dos botones distintos.
  const [cobroOpen,        setCobroOpen]        = useState(false);
  const [cobroMonto,       setCobroMonto]       = useState('');
  const [cobroForma,       setCobroForma]       = useState('');
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
  //
  // El importe arranca EN BLANCO y lo teclea quien cobra, con el dinero en la
  // mano: es justo lo que trae el cliente, no un número que la app suponga
  // (mismo criterio que tenía el abono desde el 2026-09-25). En blanco y no
  // en '0' porque el cero había que borrarlo antes de teclear, y si se
  // olvidaba quedaba pegado delante de la cifra.
  function abrirCobro() {
    setErrorAccion('');
    setCobroMonto('');
    setCobroForma('');
    setCobroOpen(true);
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null));
  }

  // Deshace la entrega: la nota finalizada vuelve a "Por Entregar", como antes
  // de confirmarla. El inventario no se mueve —el producto ya se usó en esa
  // nota— y el cobro se queda como estaba.
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

  // Confirma que la ropa ya se procesó: pasa la nota a POR ENTREGAR y le avisa
  // al cliente. Es el único camino a ese estado en Por Encargo (2026-09-28).
  //
  // El aviso va por wa.me y no por la hoja de compartir: esto es TEXTO, así que
  // sí se puede mandar a un número concreto —lo que el ticket no puede, por ser
  // una imagen— y quien atiende no tiene que buscar el chat.
  //
  // El orden importa: primero el estado y después el WhatsApp. Si el aviso no
  // se puede mandar (sin teléfono, sin mensaje escrito) la nota igual avanza;
  // al revés, un fallo al guardar dejaría al cliente avisado de algo que la app
  // sigue teniendo en proceso.
  //
  // Ya procesada, esto solo repite el aviso: el estado no se toca.
  async function enviarProcesado() {
    const avisar = () => {
      if (!mensajeProcesado.trim() || !telefonoCliente) return;
      window.open(
        `https://wa.me/${telefonoCliente}?text=${encodeURIComponent(mensajeProcesado)}`,
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

  // Cobra la nota: un solo camino para liquidar y para abonar (2026-09-26).
  //
  // Todo entra por /abonos, que ya hacía las dos cosas: registra el pago y, si
  // cubre lo que falta, marca la nota PAGADA con esa forma de pago y finaliza
  // un Autoservicio que ya terminó sus cargas —exactamente lo que hacía
  // Liquidar—. La excepción es una nota que no debe nada (total $0): ahí no
  // hay abono que registrar, /abonos lo rechaza, y se marca cobrada por el
  // camino de siempre.
  //
  // Después se relee la nota completa en vez de parchar el pago: el cobro
  // puede haber cambiado el estado, y así los botones y la línea de tiempo
  // cuentan lo mismo que el servidor.
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
      // Si el cobro la dejó pagada, el aviso de "cobra la diferencia" deja de
      // aplicar. Un abono parcial no lo quita: la nota sigue debiendo.
      if (fresca?.estado_pago === 'PAGADO') {
        limpiarAvisoCobro(id);
        setAvisoCobro(null);
      }
      setCobroOpen(false);
      setCobroMonto('');
      setCobroForma('');
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

  // La plantilla del aviso por WhatsApp (mig. 124). Va aparte de la nota y sin
  // bloquear: si los ajustes fallan, el detalle se muestra igual y el botón
  // dirá que falta configurar el mensaje.
  useEffect(() => {
    if (nota?.tipo_servicio !== 'POR_ENCARGO') return undefined;
    let activo = true;
    api.get('/ajustes')
      .then(cfg => { if (activo) setPlantillaWa(cfg?.whatsapp_mensaje_encargo ?? ''); })
      .catch(() => { if (activo) setPlantillaWa(''); });
    return () => { activo = false; };
  }, [nota?.tipo_servicio]);

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

  // Cómo se llama un renglón de la nota, igual en la lista de Cargas que en la
  // línea de tiempo. En Por Encargo hay dos clases y se numeran por separado:
  // los que traen precio son los SERVICIOS vendidos y los demás son las
  // MÁQUINAS que se agregaron en Salidas —la "Máquina 2" de aquí es la de esa
  // pantalla, aunque sea el quinto renglón de la nota—.
  const nombreDeCarga = (cg) => {
    if (!esEncargoNota) return `Carga ${cg.orden}`;
    const esServicio = cg.tope_carga != null;
    const n = (nota.cargas ?? []).filter(x => (x.tope_carga != null) === esServicio).indexOf(cg) + 1;
    return `${esServicio ? 'Servicio' : 'Máquina'} ${n}`;
  };
  // Lo abonado y lo que falta (mig. 121). El servidor los manda calculados; con
  // notas viejas o sin abonos, `saldo` es el total de la nota.
  const abonosNota = nota.abonos ?? [];
  const abonadoNota = Number(nota.abonado ?? 0);
  const saldoNota = Number(nota.saldo ?? nota.precio_total ?? 0);
  // UN solo botón de cobro (2026-09-26). Antes eran dos, "Abonar" —solo en Por
  // Encargo, para el adelanto de quien deja la ropa— y "Liquidar". En el
  // mostrador es el mismo gesto y la diferencia la decide el importe, así que
  // se cobran desde el mismo sitio. La condición es la que ya tenía Liquidar:
  // cubre a la de Abonar, que era un subconjunto suyo.
  // "Procesado": lo que pasa una nota Por Encargo a POR ENTREGAR (2026-09-28).
  //
  // Es el ÚNICO camino. Que las máquinas terminen ya no la mueve: la ropa
  // lavada todavía hay que doblarla, empacarla y revisarla, y eso lo dice una
  // persona, no un temporizador. Al confirmarlo la nota suelta sus máquinas y
  // —si hay mensaje y teléfono— se le avisa al cliente por WhatsApp (mig. 124),
  // que es el mismo gesto del mostrador: "ya está, avísale".
  //
  // Ya marcada, el botón se queda para poder REPETIR el aviso (el cliente
  // borró el mensaje, se mandó al número viejo): ahí ya no cambia el estado.
  //
  // Solo en Por Encargo: el autoservicio no captura cliente y su LISTA
  // significa otra cosa ("Por Cobrar"). Una nota terminada o cancelada no lo
  // ofrece.
  //
  // El botón se enseña aunque falte el mensaje o el teléfono: es el modal quien
  // lo explica, y la nota tiene que poder avanzar aunque no haya a quién
  // avisarle.
  const mensajeProcesado = armarMensajeWhatsapp(plantillaWa, nota);
  const telefonoCliente = telefonoWhatsapp(nota.cliente_telefono);
  const yaProcesada = nota.estado === 'LISTA';
  const botonProcesado = nota.tipo_servicio === 'POR_ENCARGO' && !esTerminal(nota) && (
    <AccionCircular
      label={yaProcesada ? 'Avisar' : 'Procesado'}
      title={yaProcesada ? 'Volver a avisarle al cliente' : 'Marcar la nota como procesada'}
      icono={yaProcesada ? IconoAvisar : IconoProcesado}
      color={yaProcesada
        ? 'bg-green-500 group-hover:bg-green-600'
        : 'bg-blue group-hover:bg-blue-700'}
      onClick={() => { setErrorAccion(''); setProcesadoOpen(true); }}
      disabled={loadingAccion}
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
      <div className="max-w-2xl mx-auto px-6 md:p-6 py-6">

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
          {botonCobrar}
          <AccionCircular
            label="Salidas"
            icono={IconoSalidas}
            color="bg-blue group-hover:bg-blue-700"
            onClick={() => navigate(`/notas/${id}/salidas`)}
          />
          {botonProcesado}
          {/* Último paso, y sigue exigiendo el cobro: una nota pendiente no se
              puede dar por entregada. En Por Encargo el botón dice ENTREGAR,
              que es lo que de verdad se hace con la ropa (2026-09-25). */}
          {puedeFinalizar(nota) && (
            <AccionCircular
              label={esEncargoNota ? 'Entregar' : 'Finalizar'}
              icono={IconoEntregar}
              color="bg-blue group-hover:bg-emerald-700"
              onClick={() => setConfirmFinalizar(true)}
              disabled={loadingAccion}
            />
          )}
          {/* Mientras la nota vive, Eliminar solo se ve donde se apunta con mouse
              o trackpad (`pointer: fine`). Con el dedo está pegado a Cancelar y
              borrar no se deshace; por ancho no salía, porque una tablet grande
              mide lo mismo que una laptop. En táctil el camino es cancelar. */}
          {puedeEliminar(nota, esAdmin) && (
            <AccionCircular
              label="Eliminar"
              icono={IconoEliminar}
              color="bg-blue group-hover:bg-red-700"
              className={eliminarSoloEnEscritorio(nota) ? 'hidden pointer-fine:flex' : 'flex'}
              onClick={() => setConfirmEliminar(true)}
              disabled={loadingAccion}
            />
          )}
        </div>
      )}
      {/* Ya cerrada, el botón se ve en los dos tamaños. Y si quedó debiendo
          —le revirtieron el pago—, sigue habiendo por dónde cobrarla. */}
      {terminal && (
        <div className="flex flex-wrap items-start gap-2">
          {botonCobrar}
          {/* Deshacer la entrega: la nota vuelve a Por Entregar, como antes de
              confirmarla. Para el error de mostrador —se entregó la nota
              equivocada—, así que es de admin (2026-09-25). */}
          {esAdmin && esEncargoNota && nota.estado === 'FINALIZADA' && (
            <AccionCircular
              label="Abrir"
              title="Deshacer la entrega"
              icono={IconoAbrirNota}
              color="bg-amber-600 group-hover:bg-amber-700"
              onClick={() => { setErrorAccion(''); setConfirmReabrir(true); }}
              disabled={loadingAccion}
            />
          )}
          {puedeEliminar(nota, esAdmin) && (
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

      <div className='space-y-6 mt-12'>

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
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 mt-12">
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

      </div>


      <div className='space-y-6 mt-6'>

      {/* De quién es la nota y cuál es. Va en su propia tarjeta —como el
          pendiente de cobro— porque es lo que se busca al abrirla desde el
          mostrador: el folio que trae el cliente en su ticket y el nombre con
          el que se le llama. Las filas de Detalles siguen ahí para quien lee la
          nota entera; aquí van grandes y a la vista. */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-5 py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide"># Nota</p>
          {/* Solo el consecutivo (1806), no el folio entero (1806-280926): es
              el número con el que se pide la nota en el mostrador, igual que en
              la lista de Notas. La fecha del folio se lee completa en la
              cabecera y en la fila # Nota de Detalles. */}
          <p className="text-2xl font-bold text-gray-900 leading-tight mt-0.5 truncate">
            {nota.folio?.split('-')[0] ?? nota.id}
          </p>
          <p className="text-sm text-gray-600 mt-1 truncate">
            {nota.cliente_nombre
              ? `${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`
              : <span className="text-gray-400 italic">Anónimo</span>}
          </p>
        </div>
        <svg className="w-8 h-8 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>

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
                  // Lo que la carga le cobra a la nota. En Por Encargo es el
                  // PRECIO DEL SERVICIO congelado en la carga (mig. 096), que ya
                  // lleva dentro su material: sumar máquinas y productos daría
                  // los $25 del jabón y la bolsa en vez de los $150 que se
                  // cobran. Lo que va encima del servicio son los productos de
                  // marca y el ajuste, igual que en el total de la nota.
                  const marcaProds = prods
                    .filter(p => p.tipo_liquido === 'marca')
                    .reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
                  const totalCarga = cg.tope_carga != null
                    ? Number(cg.tope_carga) + marcaProds + Number(cg.ajuste ?? 0)
                    : Number(cg.precio_lavadora) + Number(cg.precio_secadora)
                      + Number(cg.ajuste ?? 0) + totalProds;
                  // En Por Encargo el renglón con precio es un SERVICIO vendido;
                  // el que no lo tiene es una máquina agregada en Salidas.
                  const esServicioEncargo = esEncargoNota && cg.tope_carga != null;
                  // Y ese renglón de MÁQUINA no lleva importe: en Por Encargo lo
                  // que se cobra es el servicio, y la máquina que lo lava no
                  // suma nada. Enseñar "$0.00" dos veces por máquina hacía dudar
                  // de si faltaba cobrar algo. En Autoservicio sí lo lleva: ahí
                  // lo que se cobra ES la máquina.
                  const maquinaSinPrecio = esEncargoNota && !esServicioEncargo;
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
                        <span className="text-xs font-semibold text-gray-500">
                          {nombreDeCarga(cg)}
                        </span>
                        {!maquinaSinPrecio && (
                          <span className="text-sm font-medium text-gray-700">{fmtMonto(totalCarga)}</span>
                        )}
                      </div>
                      {maquinasCarga.length === 0 && slotsPrevistos.length === 0 ? (
                        // Un servicio no lleva máquina: las máquinas son de
                        // Salidas y van en sus propios renglones, así que aquí
                        // no hay nada que decir.
                        esServicioEncargo ? null : (
                          <span className="text-sm text-gray-400 italic">Sin máquinas</span>
                        )
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
                                  hueco y no se cobró aparte, o es una máquina de
                                  Por Encargo, que no cobra nada. */}
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

      </div>


      {/* Estado: ESCONDIDO a la espera de que el negocio decida si lo
          mantiene (2026-09-28). La línea de tiempo cuenta el proceso paso a
          paso, y el mostrador ya lo sigue desde Salidas y desde la lista de
          notas. Se vuelve a enseñar poniendo la bandera en true; lo que hay
          debajo se conserva entero para eso. */}
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
                // Cargas con alguna máquina EN USO. Van todas bajo el mismo
                // paso —lavando y secando son uno— y cada una enseña abajo la
                // fase en la que va: una carga con lavadora y secadora
                // corriendo a la vez lista las dos.
                const cargasAqui = paso.key !== 'PROCESO' ? [] : (nota.cargas ?? []).filter(cg =>
                  (cg.lavadora_id && cg.lavadora_estado === 'en_uso')
                  || (cg.secadora_id && cg.secadora_estado === 'en_uso'));
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
                      <p className="text-xs text-gray-400">{subtituloEstado(paso.key, { done, current }, fechaDePaso(paso, fechaPorEstado))}</p>

                      {/* Desglose de las cargas que están en máquina, con la
                          fase de cada una: el paso dice que la nota se está
                          procesando y esto dice en qué va cada carga. */}
                      {cargasAqui.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {cargasAqui.map(cg => (
                            <div key={cg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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

      {/* Confirmar el aviso por WhatsApp. Enseña el mensaje YA armado, con el
          nombre y la hora puestos: es lo que el cliente va a leer, y es la
          última oportunidad de ver que un comodín quedó mal escrito. */}
      {procesadoOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {yaProcesada ? 'Volver a avisar al cliente' : 'Marcar la nota como procesada'}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {/* Lo primero es lo que hace: la nota avanza. El aviso es la
                    segunda mitad del gesto, y puede no haber a quién mandarlo. */}
                {!yaProcesada && <>La nota pasa a <span className="font-medium text-gray-700">Por Entregar</span> y suelta sus máquinas. </>}
                {nota.cliente_nombre
                  ? <>Se le avisa por WhatsApp a <span className="font-medium text-gray-700">{nota.cliente_nombre}</span>
                      {nota.cliente_telefono ? ` (${nota.cliente_telefono})` : ''}.</>
                  : 'Esta nota no tiene cliente capturado.'}
              </p>
            </div>

            {!hayMensajeWhatsapp(plantillaWa) ? (
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
                <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Mensaje</p>
                <p className="mt-1.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {mensajeProcesado}
                </p>
              </div>
            )}

            {hayMensajeWhatsapp(plantillaWa) && !telefonoCliente && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
                El cliente no tiene teléfono capturado, así que no hay a dónde mandarlo.
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
                // Marcar la nota no depende del aviso: sin mensaje escrito o sin
                // teléfono, la nota igual avanza y el WhatsApp simplemente no
                // sale. Solo el botón que ÚNICAMENTE avisa necesita las dos cosas.
                disabled={loadingAccion || (yaProcesada && (!mensajeProcesado.trim() || !telefonoCliente))}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingAccion ? 'Guardando...' : yaProcesada ? 'Enviar' : 'Marcar procesada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cobro: liquidar y abonar en el mismo (2026-09-26) */}
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
