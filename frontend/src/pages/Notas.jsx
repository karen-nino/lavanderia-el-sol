import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { etiquetaEstadoNota } from '../lib/estadoNota';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { recordarListaNotas } from '../lib/filtrosNotas';
import { useAuth } from '../context/AuthContext';
import { esAdminMain as esAdminMainFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';

/**
 * Orden del filtro: el ciclo de la nota en el mostrador, con Por Cobrar junto a
 * Por Entregar. Lavando y Secando no van: se ven en Máquinas y en la nota.
 */
const ESTADOS = ['TODOS', 'EN_ESPERA', 'POR_ENTREGAR', 'PENDIENTE', 'FINALIZADA', 'CANCELADA',
  'AUTOSERVICIO', 'POR_ENCARGO'];

/** Opciones del filtro por tipo de servicio (no son un estado). */
const FILTROS_SERVICIO = ['AUTOSERVICIO', 'POR_ENCARGO'];
/** Franja con el color de cada servicio; el texto, gris como las demás opciones. */
const FILTRO_SERVICIO_CLS = {
  AUTOSERVICIO: 'border-l-4 border-blue-500 rounded-l-sm font-semibold text-gray-700',
  // mt-2: aire entre los dos servicios.
  POR_ENCARGO:  'mt-2 border-l-4 border-amber-500 rounded-l-sm font-semibold text-gray-700',
};

// Renglones por página en la tabla de escritorio.
const POR_PAGINA = 15;

/** Páginas de los botones: primera, última y una ventana alrededor de la actual ("…"). */
function rangoPaginas(actual, total) {
  const delta = 2;
  const out = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= actual - delta && i <= actual + delta)) {
      out.push(i);
    } else if (out[out.length - 1] !== '…') {
      out.push('…');
    }
  }
  return out;
}

/** "Por Entregar": listas y pagadas sin entregar (como el KPI del Dashboard). */
const ESTADOS_POR_ENTREGAR = ['LISTA', 'PAGADA'];

const FILTRO_LABEL = {
  TODOS:        'Todos',
  POR_ENTREGAR: 'Por Entregar',
  PENDIENTE:    'Por Cobrar',
  FINALIZADA:   'Finalizadas',
  CANCELADA:    'Canceladas',
  AUTOSERVICIO: 'Autoservicio',
  POR_ENCARGO:  'Por Encargo',
};

/** Mensaje del estado vacío según el filtro ("No hay notas por cobrar"). */
const FILTRO_VACIO = {
  TODOS:        'No hay notas',
  EN_ESPERA:    'No hay notas en espera',
  POR_ENTREGAR: 'No hay notas por entregar',
  FINALIZADA:   'No hay notas finalizadas',
  PENDIENTE:    'No hay notas por cobrar',
  CANCELADA:    'No hay notas canceladas',
  AUTOSERVICIO: 'No hay notas de autoservicio',
  POR_ENCARGO:  'No hay notas por encargo',
};

const RANGOS_FECHA = [
  { value: 'HOY',       label: 'Hoy' },
  { value: 'AYER',      label: 'Ayer' },
  { value: 'ULTIMOS_7', label: 'Últimos 7 días' },
  { value: 'ESTE_MES',  label: 'Este mes' },
];

/** Valores válidos del filtro de fecha: los fijos, TODAS, 'MES:YYYY-MM' y 'ANIO:YYYY'. */
function rangoFechaValido(v) {
  return v === 'TODAS'
    || RANGOS_FECHA.some(r => r.value === v)
    || /^MES:\d{4}-\d{2}$/.test(v)
    || /^ANIO:\d{4}$/.test(v);
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function calcularRangoFecha(rango) {
  if (rango === 'TODAS') return null;
  // Mes específico: 'MES:YYYY-MM'
  if (rango.startsWith('MES:')) {
    const [y, m] = rango.slice(4).split('-').map(Number);
    return { desde: new Date(y, m - 1, 1), hasta: new Date(y, m, 1) };
  }
  // Año completo: 'ANIO:YYYY'
  if (rango.startsWith('ANIO:')) {
    const y = Number(rango.slice(5));
    return { desde: new Date(y, 0, 1), hasta: new Date(y + 1, 0, 1) };
  }
  const ahora = new Date();
  const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const manana = new Date(hoyInicio); manana.setDate(manana.getDate() + 1);
  switch (rango) {
    case 'HOY':
      return { desde: hoyInicio, hasta: manana };
    case 'AYER': {
      const ayer = new Date(hoyInicio); ayer.setDate(ayer.getDate() - 1);
      return { desde: ayer, hasta: hoyInicio };
    }
    case 'ULTIMOS_7': {
      const desde = new Date(hoyInicio); desde.setDate(desde.getDate() - 6);
      return { desde, hasta: manana };
    }
    case 'ESTE_MES':
      return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1), hasta: manana };
    default:
      return null;
  }
}

/** Nombre corto del filtro de fecha para su chip ("Hoy", "Marzo 2026", "2025"). */
function etiquetaRangoFecha(rango) {
  if (!rango || rango === 'TODAS') return null;
  if (rango.startsWith('MES:')) {
    const [y, m] = rango.slice(4).split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
  }
  if (rango.startsWith('ANIO:')) return rango.slice(5);
  return RANGOS_FECHA.find(r => r.value === rango)?.label ?? null;
}

function sufijoRangoFecha(rango) {
  if (!rango || rango === 'TODAS') return '';
  if (rango.startsWith('MES:')) {
    const [y, m] = rango.slice(4).split('-').map(Number);
    return `de ${MESES[m - 1]} ${y}`;
  }
  if (rango.startsWith('ANIO:')) return `de ${rango.slice(5)}`;
  switch (rango) {
    case 'HOY':       return 'de hoy';
    case 'AYER':      return 'de ayer';
    case 'ULTIMOS_7': return 'de los últimos 7 días';
    case 'ESTE_MES':  return 'de este mes';
    default:          return '';
  }
}

const BADGE_ESTADO = {
  EN_ESPERA:  { label: 'En Espera',  cls: 'bg-gray-100 text-gray-600'       },
  LAVANDO:    { label: 'Lavando',    cls: 'bg-light-blue text-blue-700'     },
  SECANDO:    { label: 'Secando',    cls: 'bg-red-100 text-red-700'         },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800' },
  PAGADA:     { label: 'Pagada',     cls: 'bg-light-green text-green-700'   },
  FINALIZADA: { label: 'Finalizada', cls: 'bg-light-green text-green-700'   },
  CANCELADA:  { label: 'Cancelada',  cls: 'bg-red-100 text-red-700'         },
};

/** Por Encargo lavada y secada, esperando "Procesado" (sigue EN_ESPERA; lo marca el backend). */
const BADGE_DOBLADO = { label: 'Doblado', cls: 'bg-purple-100 text-purple-700' };

const BADGE_TIPO_SERVICIO = {
  AUTOSERVICIO: { label: 'Autoservicio', cls: 'bg-light-blue text-blue-700' },
  EDREDON:      { label: 'Edredón',      cls: 'bg-sky-100 text-sky-700'       },
  POR_ENCARGO:  { label: 'Por Encargo',  cls: 'bg-amber-100 text-amber-700'   },
  PRODUCTOS:    { label: 'Productos',    cls: 'bg-violet-100 text-violet-700'  },
};

const BADGE_PAGO = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-red-100 text-red-700'  },
  PAGADO: { label: 'Pagado', cls: 'bg-green-100 text-green-700' },
};

function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const TIEMPO_ENTREGA_LABEL = { MANANA: 'Mañana', DOS_DIAS: 'En 2 días', OTRA: 'Otra fecha' };

/** Fecha de entrega sin corrimiento por zona: "14 Ago". */
function fmtFechaEntrega(fecha) {
  if (!fecha) return null;
  const s = typeof fecha === 'string' ? fecha.slice(0, 10) : new Date(fecha).toISOString().slice(0, 10);
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MESES_ABR[m - 1]}`;
}

/** "Hoy", "Mañana" o la fecha completa (15 Ago 2026). */
function etiquetaFechaEntrega(fecha) {
  if (!fecha) return null;
  const s = typeof fecha === 'string' ? fecha.slice(0, 10) : new Date(fecha).toISOString().slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  return fmtFechaEntrega(fecha);
}

/** "Sábado, 03/10/26". */
function fmtFechaDia(iso) {
  const d = new Date(iso);
  const diaSem = DIAS_SEMANA[d.getDay()];
  const dia  = String(d.getDate()).padStart(2, '0');
  const mes  = String(d.getMonth() + 1).padStart(2, '0');
  const anio = String(d.getFullYear()).slice(-2);
  return `${diaSem}, ${dia}/${mes}/${anio}`;
}

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

/** Cliente del catálogo o, si no, la referencia del Autoservicio; sin ninguno, null. */
function fmtClienteCatalogo(n) {
  if (!n.cliente_nombre) return null;
  const ap = (n.cliente_apellido ?? '').trim();
  return ap ? `${n.cliente_nombre} ${ap}` : n.cliente_nombre;
}

function fmtCliente(n) {
  if (!n.cliente_nombre) return n.referencia || null;
  const ap = (n.cliente_apellido ?? '').trim();
  return ap ? `${n.cliente_nombre} ${ap}` : n.cliente_nombre;
}

function ChipFiltro({ label, onQuitar }) {
  return (
    <span className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-pill bg-light-blue text-blue-700 text-sm font-medium">
      {label}
      <button
        type="button"
        onClick={onQuitar}
        aria-label={`Quitar filtro ${label}`}
        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-blue-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

export default function Notas() {
  const navigate                              = useNavigate();
  const [searchParams, setSearchParams]       = useSearchParams();
  const { usuario }                           = useAuth();
  const esAdminMain                           = esAdminMainFn(usuario?.rol);

  // Filtro inicial desde la URL (?estado=EN_ESPERA), si es válido (p. ej. desde
  // un KPI del Dashboard).
  const estadoParam = (searchParams.get('estado') || '').toUpperCase();
  const estadoInicial = ESTADOS.includes(estadoParam) ? estadoParam : 'TODOS';

  const [notas,             setNotas]             = useState([]);
  const [filtro,            setFiltro]            = useState(estadoInicial);
  // Rango de fecha desde la URL (?fecha=TODAS, MES:2026-09, ANIO:2026…). Sin uno
  // válido: TODAS si viene con estado (para no esconder días anteriores), HOY si no.
  const fechaParam = searchParams.get('fecha') || '';
  const rangoInicial = rangoFechaValido(fechaParam)
    ? fechaParam
    : (estadoInicial !== 'TODOS' ? 'TODAS' : 'HOY');
  const [rangoFecha,        setRangoFecha]        = useState(rangoInicial);
  const [busqueda,          setBusqueda]          = useState('');
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [mostrarEstado,     setMostrarEstado]     = useState(false);
  const [mostrarFecha,      setMostrarFecha]      = useState(false);
  const [modalFecha,        setModalFecha]        = useState(null); // 'MES' | 'ANIO' | null
  const [pagina,            setPagina]            = useState(1);
  const estadoRef = useRef(null);
  const fechaRef  = useRef(null);

  // Selección múltiple para borrado en lote (admin_main, escritorio).
  const [seleccion,         setSeleccion]         = useState(() => new Set());
  const [confirmarBorrado,  setConfirmarBorrado]  = useState(false);
  const [borrando,          setBorrando]          = useState(false);
  const [errBorrado,        setErrBorrado]        = useState('');

  useEffect(() => {
    api.get('/notas')
      .then(setNotas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // "Notas" del menú lleva a /notas sin `fecha` (la lista siempre la escribe):
  // eso reinicia a Hoy, sin estado, búsqueda ni página (respeta un estado que
  // venga en la URL). Se ajusta durante el render, no en un efecto.
  const sinFecha = !searchParams.has('fecha');
  const [sinFechaPrevio, setSinFechaPrevio] = useState(sinFecha);
  if (sinFecha !== sinFechaPrevio) {
    setSinFechaPrevio(sinFecha);
    if (sinFecha) {
      setFiltro(estadoInicial);
      setRangoFecha(estadoInicial !== 'TODOS' ? 'TODAS' : 'HOY');
      setBusqueda('');
      setPagina(1);
    }
  }

  // Los filtros viven en la URL (sin llenar el historial): al volver con "atrás"
  // la lista conserva su filtro.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filtro !== 'TODOS') params.set('estado', filtro);
    params.set('fecha', rangoFecha);
    setSearchParams(params, { replace: true });
    // También se guarda para el botón "Volver" del detalle.
    recordarListaNotas(`/notas?${params}`);
  }, [filtro, rangoFecha, setSearchParams]);

  useEffect(() => {
    if (!mostrarEstado && !mostrarFecha) return;
    const onMouseDown = (e) => {
      if (mostrarEstado && estadoRef.current && !estadoRef.current.contains(e.target)) {
        setMostrarEstado(false);
      }
      if (mostrarFecha && fechaRef.current && !fechaRef.current.contains(e.target)) {
        setMostrarFecha(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mostrarEstado, mostrarFecha]);

  // Minúsculas y sin acentos, para que la búsqueda los ignore (igual que en Clientes).
  const normalizar = (s) =>
    (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = normalizar(busqueda.trim());
  const rango = useMemo(() => calcularRangoFecha(rangoFecha), [rangoFecha]);

  // Años con notas y meses del año en curso con notas, para "Por año" / "Por mes".
  const anioActual = new Date().getFullYear();
  const { aniosConNotas, mesesAnioActual } = useMemo(() => {
    const anios = new Set();
    const mesesActual = new Set(); // números de mes (1-12) del año en curso
    for (const n of notas) {
      const d = new Date(n.created_at);
      if (Number.isNaN(d.getTime())) continue;
      anios.add(d.getFullYear());
      if (d.getFullYear() === anioActual) mesesActual.add(d.getMonth() + 1);
    }
    return {
      aniosConNotas: [...anios].sort((a, b) => b - a),
      mesesAnioActual: mesesActual,
    };
  }, [notas, anioActual]);

  const filtradas = notas.filter(n => {
    // Las canceladas solo salen en su propio filtro.
    if (n.estado === 'CANCELADA' && filtro !== 'CANCELADA') return false;
    if (filtro === 'PENDIENTE') {
      if (n.estado_pago !== 'PENDIENTE') return false;
    } else if (filtro === 'POR_ENTREGAR') {
      if (!ESTADOS_POR_ENTREGAR.includes(n.estado)) return false;
    } else if (FILTROS_SERVICIO.includes(filtro)) {
      if (n.tipo_servicio !== filtro) return false;
    } else if (filtro !== 'TODOS' && n.estado !== filtro) {
      return false;
    }
    if (rango) {
      const fecha = new Date(n.created_at);
      if (fecha < rango.desde || fecha >= rango.hasta) return false;
    }
    if (!q) return true;
    const folio    = normalizar(n.folio ?? `#${n.id}`);
    const cliente  = normalizar(n.cliente_nombre);
    const apellido = normalizar(n.cliente_apellido);
    const telefono = normalizar(n.cliente_telefono);
    const referencia = normalizar(n.referencia);
    return folio.includes(q) || cliente.includes(q) || apellido.includes(q) || telefono.includes(q)
      || referencia.includes(q);
  });

  // Chips de los filtros activos, bajo la búsqueda y a la derecha; se quitan con su ✕.
  const chipsFiltros = (filtro !== 'TODOS' || rangoFecha !== 'TODAS') && (
    <div className="flex flex-wrap justify-end gap-2">
      {filtro !== 'TODOS' && (
        <ChipFiltro
          label={FILTRO_LABEL[filtro] ?? BADGE_ESTADO[filtro]?.label}
          onQuitar={() => { setFiltro('TODOS'); setPagina(1); }}
        />
      )}
      {etiquetaRangoFecha(rangoFecha) && (
        <ChipFiltro
          label={etiquetaRangoFecha(rangoFecha)}
          onQuitar={() => { setRangoFecha('TODAS'); setPagina(1); }}
        />
      )}
    </div>
  );

  // Paginación (escritorio). `paginaActual` se acota por si quedó fuera de rango.
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaActual = Math.min(Math.max(1, pagina), totalPaginas);
  const paginadas = filtradas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  // En móvil, agrupadas por día con un encabezado de fecha, en el orden filtrado.
  const gruposMobile = [];
  const claveHoy = new Date().toDateString();
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const claveAyer = ayer.toDateString();
  for (const n of filtradas) {
    const clave = new Date(n.created_at).toDateString();
    const ultimo = gruposMobile[gruposMobile.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.notas.push(n);
    // Hoy y ayer se titulan "Hoy" y "Ayer" en lugar de su fecha.
    else {
      const fecha = clave === claveHoy ? 'Hoy' : clave === claveAyer ? 'Ayer' : fmtFechaDia(n.created_at);
      gruposMobile.push({ clave, fecha, notas: [n] });
    }
  }

  // ── Selección múltiple (admin_main) ─────────────────────
  const toggleSeleccion = (id) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const todasSeleccionadas = filtradas.length > 0 && filtradas.every(n => seleccion.has(n.id));
  const toggleTodas = () => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (filtradas.every(n => next.has(n.id))) filtradas.forEach(n => next.delete(n.id));
      else filtradas.forEach(n => next.add(n.id));
      return next;
    });
  };
  const limpiarSeleccion = () => setSeleccion(new Set());

  // Borra las seleccionadas una por una (DELETE /notas/:id), aunque alguna falle.
  const borrarSeleccionadas = async () => {
    setErrBorrado('');
    setBorrando(true);
    const ids = [...seleccion];
    const borradas = [];
    const fallidas = [];
    // El motivo del primer fallo (casi siempre es el mismo).
    let motivo = '';
    for (const id of ids) {
      try {
        await api.delete(`/notas/${id}`);
        borradas.push(id);
      } catch (err) {
        fallidas.push(id);
        if (!motivo && err?.message) motivo = err.message;
      }
    }
    if (borradas.length > 0) {
      const set = new Set(borradas);
      setNotas(prev => prev.filter(n => !set.has(n.id)));
    }
    setSeleccion(new Set(fallidas));
    setBorrando(false);
    setConfirmarBorrado(false);
    if (fallidas.length > 0) {
      setErrBorrado(`No se pudieron eliminar ${fallidas.length} nota(s).`
        + (motivo ? ` ${motivo}` : ''));
    }
  };


  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? '\u00a0' : `${filtradas.length} ${filtradas.length === 1 ? 'nota' : 'notas'}`}
          </p>
        </div>
        {/* `relative` en la fila: los paneles (224 px) se abren a la izquierda y así
            no se salen de la pantalla en celulares angostos. Siguen dentro del div
            con ref, para detectar el clic fuera. */}
        <div className="flex items-center gap-3 relative">
          <div ref={estadoRef}>
            <button
              onClick={() => { setMostrarEstado(v => !v); setMostrarFecha(false); }}
              aria-label="Filtrar por estado"
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                filtro !== 'TODOS'
                  ? 'border-blue bg-light-blue text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M4 6h16M7 12h10M10 18h4" />
              </svg>
            </button>

            {mostrarEstado && (
              <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56 max-w-[calc(100vw-2rem)]">
                <p className="text-sm font-semibold text-gray-500 uppercase mb-2 px-1">Estado</p>
                <div className="flex flex-col gap-1">
                  {ESTADOS.map(e => (
                    <Fragment key={e}>
                    {/* Las de tipo de servicio van aparte, con su título. */}
                    {e === FILTROS_SERVICIO[0] && (
                      <p className="text-sm font-semibold text-gray-500 uppercase mt-2 mb-1 px-1 pt-2 border-t border-gray-100">Servicio</p>
                    )}
                    <button
                      // Al elegir un estado se busca en todas las fechas (para no esconder las de
                      // días anteriores); el filtro de fecha acota.
                      onClick={() => { setFiltro(e); setRangoFecha('TODAS'); setPagina(1); setMostrarEstado(false); }}
                      className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                        // Los de servicio llevan franja de color y negritas.
                        FILTRO_SERVICIO_CLS[e] ?? ''
                      } ${
                        FILTROS_SERVICIO.includes(e)
                          ? (filtro === e ? 'bg-light-blue' : 'hover:bg-gray-50')
                          : filtro === e
                            ? 'bg-light-blue text-blue-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {FILTRO_LABEL[e] ?? BADGE_ESTADO[e]?.label}
                    </button>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div ref={fechaRef}>
            <button
              onClick={() => { setMostrarFecha(v => !v); setMostrarEstado(false); }}
              aria-label="Filtrar por fecha"
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${
                rangoFecha !== 'TODAS'
                  ? 'border-blue bg-light-blue text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="16" rx="2" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </button>

            {mostrarFecha && (
              <div className="absolute right-0 top-12 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-56 max-w-[calc(100vw-2rem)]">
                <p className="text-sm font-semibold text-gray-500 uppercase mb-2 px-1">Fecha</p>
                <div className="flex flex-col gap-1">
                  {RANGOS_FECHA.map(r => (
                    <button
                      key={r.value}
                      onClick={() => { setRangoFecha(r.value); setPagina(1); setMostrarFecha(false); }}
                      className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                        rangoFecha === r.value
                          ? 'bg-light-blue text-blue-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}

                  <button
                    onClick={() => { setMostrarFecha(false); setModalFecha('MES'); }}
                    className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                      rangoFecha.startsWith('MES:')
                        ? 'bg-light-blue text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {rangoFecha.startsWith('MES:') ? MESES[Number(rangoFecha.slice(9, 11)) - 1] : 'Por mes'}
                  </button>
                  <button
                    onClick={() => { setMostrarFecha(false); setModalFecha('ANIO'); }}
                    className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                      rangoFecha.startsWith('ANIO:')
                        ? 'bg-light-blue text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {rangoFecha.startsWith('ANIO:') ? rangoFecha.slice(5) : 'Por año'}
                  </button>
                  {/* "Todas las fechas" al final: es la que quita el filtro. */}
                  <button
                    onClick={() => { setRangoFecha('TODAS'); setPagina(1); setMostrarFecha(false); }}
                    className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                      rangoFecha === 'TODAS'
                        ? 'bg-light-blue text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Todas las fechas
                  </button>
                </div>
              </div>
            )}
          </div>

          <Link
            to="/notas/nueva"
            aria-label="Nueva nota"
            className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </div>
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

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
          onChange={e => { setBusqueda(e.target.value); setPagina(1); }}
          className="w-full pl-11 pr-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent bg-white transition"
        />
      </div>

      {chipsFiltros}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
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
            {busqueda
              ? 'No se encontraron notas con ese criterio'
              : `${FILTRO_VACIO[filtro] ?? 'No hay notas'} ${sufijoRangoFecha(rangoFecha)}`.trim()}
          </p>
        </div>
      )}

      {!loading && !error && filtradas.length > 0 && (
        <>
          {/* Barra de selección múltiple (admin_main, desktop) */}
          {esAdminMain && seleccion.size > 0 && (
            <div className="hidden lg:flex items-center justify-between gap-3 bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 mb-3">
              <span className="text-sm text-gray-700">
                {seleccion.size} nota(s) seleccionada(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={limpiarSeleccion}
                  className="text-sm text-gray-500 hover:text-gray-700 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Limpiar
                </button>
                <button
                  onClick={() => { setErrBorrado(''); setConfirmarBorrado(true); }}
                  className="text-sm font-medium text-white bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded-lg transition-colors"
                >
                  Eliminar seleccionadas
                </button>
              </div>
            </div>
          )}
          {esAdminMain && errBorrado && (
            <div className="hidden lg:block bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{errBorrado}</div>
          )}

          {/* Tabla desde lg */}
          <div className="hidden lg:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {esAdminMain && (
                        <th className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={todasSeleccionadas}
                            onChange={toggleTodas}
                            aria-label="Seleccionar todas"
                            className="w-4 h-4 rounded border-gray-300 text-blue focus:ring-blue cursor-pointer"
                          />
                        </th>
                      )}
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Folio</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Fecha</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Tipo</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Cliente</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Referencia</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Pago</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Total</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Entrega</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paginadas.map(n => {
                      const badgeEstado    = n.doblado ? BADGE_DOBLADO : (BADGE_ESTADO[n.estado] ?? BADGE_ESTADO.LAVANDO);
                      const badgeTipoServicio = BADGE_TIPO_SERVICIO[n.tipo_servicio] ?? BADGE_TIPO_SERVICIO.AUTOSERVICIO;
                      // Cancelada no tiene estado de pago: no se va a cobrar.
                      const badgePago      = n.estado === 'CANCELADA' ? null : BADGE_PAGO[n.estado_pago];
                      // Lavando y secando a la vez (cargas en distinta fase).
                      const lavandoYSecando = ['LAVANDO', 'SECANDO'].includes(n.estado)
                        && n.hay_lavadora_activa && n.hay_secadora_activa;
                      return (
                        <tr
                          key={n.id}
                          onClick={() => navigate(`/notas/${n.id}`)}
                          className={`hover:bg-light-blue transition-colors cursor-pointer ${seleccion.has(n.id) ? 'bg-light-blue/60' : ''}`}
                        >
                          {esAdminMain && (
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={seleccion.has(n.id)}
                                onChange={() => toggleSeleccion(n.id)}
                                aria-label={`Seleccionar nota ${n.folio ?? n.id}`}
                                className="w-4 h-4 rounded border-gray-300 text-blue focus:ring-blue cursor-pointer"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 font-mono text-sm text-gray-600">
                            #{n.folio?.split('-')[0] ?? n.id}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-sm">
                            {fmtFecha(n.created_at)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {badgeTipoServicio.label}
                          </td>
                          <td className="px-4 py-3">
                            {/* Aquí solo el cliente del catálogo; la referencia va en su columna. */}
                            <p className="font-medium text-gray-800">
                              {fmtClienteCatalogo(n) ?? <span className="text-gray-400 italic">Mostrador</span>}
                            </p>
                            {n.cliente_telefono && (
                              <p className="text-sm text-gray-400">{n.cliente_telefono}</p>
                            )}
                          </td>
                          {/* Cliente / referencia libre del Autoservicio. */}
                          <td className="px-4 py-3 text-gray-700">
                            {n.referencia || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {lavandoYSecando ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${BADGE_ESTADO.LAVANDO.cls}`}>
                                  {BADGE_ESTADO.LAVANDO.label}
                                </span>
                                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${BADGE_ESTADO.SECANDO.cls}`}>
                                  {BADGE_ESTADO.SECANDO.label}
                                </span>
                              </div>
                            ) : (
                              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeEstado.cls}`}>
                                {etiquetaEstadoNota(n.estado, n.tipo_servicio, badgeEstado.label)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {badgePago && (
                              n.estado_pago === 'PAGADO' ? (
                                // Pagado va como texto plano; solo Pendiente conserva su pill.
                                <span className="text-sm text-gray-600">{badgePago.label}</span>
                              ) : (
                                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgePago.cls}`}>
                                  {badgePago.label}
                                </span>
                              )
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {fmtMonto(n.precio_total)}
                            {n.secadora_por_definir && (
                              <span className="block text-sm font-medium text-amber-700">+ por definir</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {n.fecha_entrega ? (
                              <span className="text-gray-600">
                                {etiquetaFechaEntrega(n.fecha_entrega)}
                                {n.tiempo_entrega && (
                                  <span className="text-gray-400"> · {TIEMPO_ENTREGA_LABEL[n.tiempo_entrega] ?? n.tiempo_entrega}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
              </table>
            </div>
          </div>

          {/* Paginación (escritorio) — siempre visible */}
          <div className="hidden lg:flex items-center justify-between gap-3 mt-3">
            <span className="text-sm text-gray-500">
              {filtradas.length === 0
                ? 'Sin notas'
                : `${(paginaActual - 1) * POR_PAGINA + 1}–${Math.min(paginaActual * POR_PAGINA, filtradas.length)} de ${filtradas.length}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPagina(Math.max(1, paginaActual - 1))}
                disabled={paginaActual <= 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Página anterior"
              >
                Anterior
              </button>
              {rangoPaginas(paginaActual, totalPaginas).map((p, i) => (
                p === '…' ? (
                  <span key={`e${i}`} className="px-2 text-gray-400 text-sm select-none">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPagina(p)}
                    aria-current={p === paginaActual ? 'page' : undefined}
                    className={`min-w-[2.25rem] px-2 py-1.5 rounded-lg border text-sm transition-colors ${
                      p === paginaActual
                        ? 'border-blue bg-blue text-white font-semibold'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              ))}
              <button
                onClick={() => setPagina(Math.min(totalPaginas, paginaActual + 1))}
                disabled={paginaActual >= totalPaginas}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Página siguiente"
              >
                Siguiente
              </button>
            </div>
          </div>

          {/* Tarjetas abajo de lg, agrupadas por día. */}
          <div className="lg:hidden space-y-16">
            {gruposMobile.map((grupo) => (
              <div key={grupo.clave} className="space-y-4">
                <h3 className="text-sm font-bold text-dark-blue px-1">{grupo.fecha}</h3>
                {/* Una por fila en celular, dos en tableta. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {grupo.notas.map(n => {
              const badgeEstado    = n.doblado ? BADGE_DOBLADO : (BADGE_ESTADO[n.estado] ?? BADGE_ESTADO.LAVANDO);
              // Cancelada no tiene estado de pago: no se va a cobrar.
              const badgePago      = n.estado === 'CANCELADA' ? null : BADGE_PAGO[n.estado_pago];
              // Sin cliente, "Mostrador" (como la tabla y el detalle).
              const cliente        = fmtCliente(n) ?? 'Mostrador';
              // Con varias cargas puede lavar y secar a la vez: se apilan los dos estados.
              const lavandoYSecando = ['LAVANDO', 'SECANDO'].includes(n.estado)
                && n.hay_lavadora_activa && n.hay_secadora_activa;
              // Máquinas asignadas o usadas; las que corren ahora, en azul.
              const enUso    = new Set(n.maquinas_en_uso ?? []);
              const maquinas = [...new Set([...(n.maquinas_nombres ?? []), ...enUso])]
                .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
              return (
                <div
                  key={n.id}
                  className="bg-white rounded-card shadow-card border border-gray-100 px-5 py-4 active:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/notas/${n.id}`)}
                >
                  {/* Folio + estado */}
                  <div className="flex items-start justify-between gap-2 pb-2">
                    <p className="text-md font-bold text-dark-blue/70">#{n.folio?.split('-')[0] ?? n.id}</p>
                    {lavandoYSecando ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs font-bold tracking-wide px-3 py-1 rounded-pill ${BADGE_ESTADO.LAVANDO.cls}`}>
                          {BADGE_ESTADO.LAVANDO.label}
                        </span>
                        <span className={`text-xs font-bold tracking-wide px-3 py-1 rounded-pill ${BADGE_ESTADO.SECANDO.cls}`}>
                          {BADGE_ESTADO.SECANDO.label}
                        </span>
                      </div>
                    ) : (
                      <span className={`text-xs font-bold tracking-wide px-3 py-1 rounded-pill ${badgeEstado.cls}`}>
                        {etiquetaEstadoNota(n.estado, n.tipo_servicio, badgeEstado.label)}
                      </span>
                    )}
                  </div>

                  {/* Cliente y total. */}
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <p className="text-xl font-semibold">{cliente}</p>
                    <p className="text-xl font-bold text-right">
                      {fmtMonto(n.precio_total)}
                      {/* Secadora que cobra por programa, aún sin precio. */}
                      {n.secadora_por_definir && (
                        <span className="block text-sm font-medium text-amber-700">+ por definir</span>
                      )}
                    </p>
                  </div>

                  {/* Máquinas de la nota: las asignadas y las que ya usó.
                      Mientras alguna corre, el rótulo dice "Usando". */}
                  {maquinas.length > 0 && (
                    <>
                      <div className="border-t border-dashed border-gray-300 my-4" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-dark-grey">
                          {enUso.size > 0
                            ? (maquinas.length === 1 ? 'Usando máquina' : 'Usando máquinas')
                            : (maquinas.length === 1 ? 'Máquina' : 'Máquinas')}
                        </span>
                        <span className="text-sm font-bold text-right">
                          {maquinas.map((m, i) => (
                            <span key={m} className={enUso.has(m) ? 'text-blue-700' : 'text-dark-grey'}>
                              {m}{i < maquinas.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Estado de pago (fecha y hora en el detalle). */}
                  {badgePago && (
                    <>
                      <div className={`border-t border-dashed border-gray-300 ${maquinas.length > 0 ? 'my-3' : 'my-4'}`} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-dark-grey">Estado de pago</span>
                        <span className={`text-sm font-bold ${n.estado_pago === 'PENDIENTE' ? 'text-red' : 'text-dark-grey'}`}>
                          {badgePago.label}
                        </span>
                      </div>
                    </>
                  )}

                </div>
              );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      </div>

      {/* Modal confirmar borrado múltiple (admin_main) */}
      {confirmarBorrado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Eliminar notas</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  ¿Eliminar <span className="font-medium text-gray-700">{seleccion.size}</span> nota(s)? Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmarBorrado(false)}
                disabled={borrando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={borrarSeleccionadas}
                disabled={borrando}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {borrando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Por mes": los 12 meses del año en curso; sin notas, deshabilitados. */}
      {modalFecha === 'MES' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setModalFecha(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs max-h-modal overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Selecciona un mes</h3>
              <span className="text-sm font-medium text-gray-500">{anioActual}</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {MESES_ABR.map((abr, i) => {
                const mesNum  = i + 1;
                const ym      = `${anioActual}-${String(mesNum).padStart(2, '0')}`;
                const hayNotas = mesesAnioActual.has(mesNum);
                const activo  = rangoFecha === `MES:${ym}`;
                return (
                  <button
                    key={abr}
                    disabled={!hayNotas}
                    onClick={() => { setRangoFecha(`MES:${ym}`); setPagina(1); setModalFecha(null); }}
                    className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      activo
                        ? 'bg-blue text-white'
                        : hayNotas
                          ? 'bg-gray-50 text-gray-800 hover:bg-gray-100'
                          : 'text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {abr}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selector "Por año": años que tienen notas. */}
      {modalFecha === 'ANIO' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setModalFecha(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs max-h-modal overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-4">Selecciona un año</h3>
            {aniosConNotas.length === 0 ? (
              <p className="text-sm text-gray-500">No hay notas registradas.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {aniosConNotas.map(anio => {
                  const activo = rangoFecha === `ANIO:${anio}`;
                  return (
                    <button
                      key={anio}
                      onClick={() => { setRangoFecha(`ANIO:${anio}`); setPagina(1); setModalFecha(null); }}
                      className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activo ? 'bg-blue text-white' : 'bg-gray-50 text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      {anio}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
