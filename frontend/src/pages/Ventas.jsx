import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import SucursalBar from '../components/SucursalBar';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

// Parte YYYY-MM-DD de una fecha (evita corrimientos por zona horaria).
const ymd = (fecha) => {
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Date en horario local a partir de solo la parte de fecha (sin corrimiento).
const fechaLocal = (fecha) => {
  const [y, m, d] = ymd(fecha).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const fmtFecha = (fecha) => {
  if (!fecha) return '—';
  return fechaLocal(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Nombre del día de la semana capitalizado (Lunes, Martes, …).
const fmtDiaSemana = (fecha) => {
  if (!fecha) return '—';
  const s = fechaLocal(fecha).toLocaleDateString('es-MX', { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// Versión abreviada (Lun, Mar, Mié, …) para cuando hay poco espacio (mobile).
const fmtDiaSemanaCorto = (fecha) => {
  if (!fecha) return '—';
  return fmtDiaSemana(fecha).slice(0, 3);
};

const NOTAS_POR_PAGINA = 10;

const ESTADO_BADGE = {
  EN_ESPERA:  { label: 'En Espera',    cls: 'bg-gray-100 text-gray-600'     },
  LAVANDO:    { label: 'Lavando',      cls: 'bg-light-blue text-blue-700'   },
  SECANDO:    { label: 'Secando',      cls: 'bg-red-100 text-red-700'       },
  LISTA:      { label: 'Por Entregar', cls: 'bg-yellow-100 text-yellow-800' },
  PAGADA:     { label: 'Pagada',       cls: 'bg-light-green text-green-700' },
  FINALIZADA: { label: 'Finalizada',   cls: 'bg-light-green text-green-700' },
  CANCELADA:  { label: 'Cancelada',    cls: 'bg-red-100 text-red-700'       },
};

function EstadoBadge({ estado }) {
  const b = ESTADO_BADGE[estado];
  if (!b) return <span className="text-gray-400">—</span>;
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${b.cls}`}>
      {b.label}
    </span>
  );
}

const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Mes' },
  { id: 'anio',   label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];

// Nombres de meses capitalizados (Enero … Diciembre) para el selector de mes.
const MESES = Array.from({ length: 12 }, (_, i) => {
  const m = new Date(2020, i, 1).toLocaleDateString('es-MX', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
});

function Tarjeta({ titulo, valor, sub, color }) {
  const colores = {
    azul:    'bg-blue-50 border-blue-200 text-blue-700',
    verde:   'bg-green-50 border-green-200 text-green-700',
    morado:  'bg-light-blue border-blue-200 text-blue-700',
    naranja: 'bg-orange-50 border-orange-200 text-orange-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colores[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{titulo}</p>
      <p className="mt-1 text-2xl font-bold">{valor}</p>
      {sub && <p className="mt-0.5 text-xs opacity-60">{sub}</p>}
    </div>
  );
}

function CustomTooltip({ active, payload, label, periodo }) {
  if (!active || !payload?.length) return null;
  // En la vista anual cada barra es un mes: se muestra "Mes Año" en vez de una
  // fecha con día (que sería engañosa, siempre el día 1).
  const titulo = periodo === 'anio'
    ? `${MESES[fechaLocal(label).getMonth()]} ${fechaLocal(label).getFullYear()}`
    : fmtFecha(label);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-sm">
      <p className="font-medium text-gray-700">{titulo}</p>
      <p className="text-blue font-semibold">{fmt(payload[0].value)}</p>
    </div>
  );
}

export default function Ventas() {
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paginaNotas, setPaginaNotas] = useState(1);
  // En pantallas angostas (mobile) los nombres de los días se abrevian para que
  // los 7 quepan sin encimarse en el eje X de la gráfica semanal.
  const [esAngosto, setEsAngosto] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setEsAngosto(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const anioActual = new Date().getFullYear();
  const [anioSel, setAnioSel] = useState(anioActual);
  const [aniosDisponibles, setAniosDisponibles] = useState([]);
  const [mostrarAnios, setMostrarAnios] = useState(false);
  const anioRef = useRef(null);

  const [mesSel, setMesSel] = useState(() => new Date().getMonth());
  const [mostrarMeses, setMostrarMeses] = useState(false);
  const mesRef = useRef(null);

  useEffect(() => {
    if (periodo === 'custom' && (!desde || !hasta)) return;
    let activo = true;
    let url = `/ventas/resumen?periodo=${periodo}`;
    if (periodo === 'custom') url += `&desde=${desde}&hasta=${hasta}`;
    if (periodo === 'anio') url += `&year=${anioSel}`;
    if (periodo === 'mes') url += `&month=${mesSel}&year=${anioSel}`;
    api.get(url)
      .then(result => { if (activo) { setData(result); setError(null); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [periodo, desde, hasta, anioSel, mesSel]);

  // Años disponibles para el selector (siempre incluye el año en curso).
  useEffect(() => {
    api.get('/ventas/anios').then(setAniosDisponibles).catch(() => {});
  }, []);
  const anios = useMemo(
    () => [...new Set([anioActual, ...aniosDisponibles])].sort((a, b) => b - a),
    [aniosDisponibles, anioActual]
  );

  // Datos de la gráfica, rellenando con 0 los días sin ventas:
  //  - "semana": los 7 días de la semana en curso (Lunes a Domingo).
  //  - "mes": todos los días del mes seleccionado (1 … último).
  //  - otros períodos: la gráfica tal cual la manda el backend.
  const graficaData = useMemo(() => {
    const g = data?.grafica ?? [];
    if (periodo === 'semana') {
      const porFecha = new Map(g.map(d => [ymd(d.fecha), Number(d.total) || 0]));
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      // Lunes de esta semana: getDay() da 0=Domingo … 6=Sábado; se retrocede al lunes.
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(lunes);
        d.setDate(lunes.getDate() + i);
        const key = ymd(d);
        dias.push({ fecha: key, total: porFecha.get(key) ?? 0 });
      }
      return dias;
    }
    if (periodo === 'mes') {
      const porFecha = new Map(g.map(d => [ymd(d.fecha), Number(d.total) || 0]));
      const diasEnMes = new Date(anioSel, mesSel + 1, 0).getDate();
      const dias = [];
      for (let day = 1; day <= diasEnMes; day++) {
        const key = ymd(new Date(anioSel, mesSel, day));
        dias.push({ fecha: key, total: porFecha.get(key) ?? 0 });
      }
      return dias;
    }
    if (periodo === 'anio') {
      // Se agregan los datos diarios por mes: 12 barras (Enero … Diciembre).
      const porMes = new Array(12).fill(0);
      for (const d of g) porMes[fechaLocal(d.fecha).getMonth()] += Number(d.total) || 0;
      return porMes.map((total, m) => ({
        fecha: `${anioSel}-${String(m + 1).padStart(2, '0')}-01`,
        total,
      }));
    }
    if (periodo === 'custom') {
      if (!desde || !hasta) return g;
      // Todos los días del rango elegido, rellenando con 0 los que no tuvieron ventas.
      const porFecha = new Map(g.map(d => [ymd(d.fecha), Number(d.total) || 0]));
      const fin = fechaLocal(hasta);
      const dias = [];
      for (let d = fechaLocal(desde); d <= fin; d.setDate(d.getDate() + 1)) {
        const key = ymd(d);
        dias.push({ fecha: key, total: porFecha.get(key) ?? 0 });
      }
      return dias;
    }
    return g;
  }, [data, periodo, anioSel, mesSel, desde, hasta]);

  // Título de la vista semanal con el rango de la semana en curso, p. ej.
  // "Ingresos del 10 al 16 de Agosto" (si cruza de mes, muestra ambos meses).
  const tituloSemana = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    const mesL = MESES[lunes.getMonth()];
    const mesD = MESES[domingo.getMonth()];
    return lunes.getMonth() === domingo.getMonth()
      ? `Ingresos del ${lunes.getDate()} - ${domingo.getDate()} de ${mesL}`
      : `Ingresos del ${lunes.getDate()} de ${mesL} - ${domingo.getDate()} de ${mesD}`;
  }, []);

  // Título del período personalizado con el rango elegido, p. ej.
  // "Ingresos del 10 de Agosto al 13 de Agosto 2026". Si el rango cruza de año,
  // muestra el año en ambas fechas.
  const tituloPersonalizado = useMemo(() => {
    if (!desde || !hasta) return 'Ingresos';
    const d1 = fechaLocal(desde);
    const d2 = fechaLocal(hasta);
    const mismoAnio = d1.getFullYear() === d2.getFullYear();
    const p1 = `${d1.getDate()} de ${MESES[d1.getMonth()]}${mismoAnio ? '' : ` ${d1.getFullYear()}`}`;
    const p2 = `${d2.getDate()} de ${MESES[d2.getMonth()]} ${d2.getFullYear()}`;
    return `Ingresos del ${p1} al ${p2}`;
  }, [desde, hasta]);

  // Cierra el selector de año al hacer clic fuera.
  useEffect(() => {
    if (!mostrarAnios) return;
    const onDown = (e) => {
      if (anioRef.current && !anioRef.current.contains(e.target)) setMostrarAnios(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarAnios]);

  // Cierra el selector de mes al hacer clic fuera.
  useEffect(() => {
    if (!mostrarMeses) return;
    const onDown = (e) => {
      if (mesRef.current && !mesRef.current.contains(e.target)) setMostrarMeses(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarMeses]);

  const listaNotas   = data?.lista_notas ?? [];
  const totalPaginas = Math.max(1, Math.ceil(listaNotas.length / NOTAS_POR_PAGINA));
  const paginaSegura = Math.min(paginaNotas, totalPaginas);
  const notasPagina  = listaNotas.slice((paginaSegura - 1) * NOTAS_POR_PAGINA, paginaSegura * NOTAS_POR_PAGINA);

  // Etiqueta del filtro activo, para mostrarla como subtítulo del encabezado.
  const fmtDiaMes = (s) => {
    if (!s) return '';
    return new Date(`${s}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const filtroLabel = (() => {
    switch (periodo) {
      case 'hoy':    return 'Hoy';
      case 'semana': return 'Esta semana';
      case 'mes':    return `${MESES[mesSel]} ${anioSel}`;
      case 'anio':   return `${anioSel}`;
      case 'custom': return (desde && hasta) ? `Del ${fmtDiaMes(desde)} al ${fmtDiaMes(hasta)}` : 'Personalizado';
      default:       return '';
    }
  })();

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4">
          <h1 className="text-xl font-bold text-gray-800">Ventas</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtroLabel}</p>
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-6 space-y-6">

      {/* Filtro de período */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            // El período "mes" es un selector: muestra el mes elegido y
            // despliega la lista de meses (del año en curso).
            if (p.id === 'mes') {
              const activoMes = periodo === 'mes';
              return (
                <div key={p.id} ref={mesRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('mes'); setPaginaNotas(1); setMostrarAnios(false); setMostrarMeses(v => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activoMes
                        ? 'bg-blue text-white'
                        : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {MESES[mesSel]}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {mostrarMeses && (
                    <div className="absolute left-0 top-10 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-40 max-h-64 overflow-y-auto">
                      {MESES.map((nombre, i) => (
                        <button
                          key={i}
                          onClick={() => { setMesSel(i); setPeriodo('mes'); setMostrarMeses(false); setPaginaNotas(1); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            mesSel === i
                              ? 'bg-light-blue text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            // El período "año" es un selector: muestra el año elegido y
            // despliega la lista de años disponibles.
            if (p.id === 'anio') {
              const activo = periodo === 'anio';
              return (
                <div key={p.id} ref={anioRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('anio'); setPaginaNotas(1); setMostrarMeses(false); setMostrarAnios(v => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activo
                        ? 'bg-blue text-white'
                        : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {anioSel}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {mostrarAnios && (
                    <div className="absolute left-0 top-10 z-10 bg-white border border-gray-200 rounded-xl shadow-lg p-2 w-32 max-h-64 overflow-y-auto">
                      {anios.map((y) => (
                        <button
                          key={y}
                          onClick={() => { setAnioSel(y); setPeriodo('anio'); setMostrarAnios(false); setPaginaNotas(1); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            anioSel === y
                              ? 'bg-light-blue text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={p.id}
                onClick={() => { setPeriodo(p.id); setPaginaNotas(1); setMostrarAnios(false); setMostrarMeses(false); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  periodo === p.id
                    ? 'bg-blue text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {periodo === 'custom' && (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => { setDesde(e.target.value); setPaginaNotas(1); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => { setHasta(e.target.value); setPaginaNotas(1); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Tarjetas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tarjeta
              titulo="Total cobrado"
              valor={fmt(data.tarjetas.total_cobrado)}
              color="azul"
            />
            <Tarjeta
              titulo="Notas pagadas"
              valor={data.tarjetas.notas_pagadas}
              color="verde"
            />
            <Tarjeta
              titulo="Productos consumidos"
              valor={data.tarjetas.productos_consumidos}
              sub="unidades"
              color="morado"
            />
            <Tarjeta
              titulo="Saldo pendiente"
              valor={data.tarjetas.notas_pendientes}
              sub="notas con saldo"
              color="naranja"
            />
          </div>

          {/* Gráfica */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">
              {periodo === 'semana' ? tituloSemana
                : periodo === 'mes' ? `Ingresos en ${MESES[mesSel]} ${anioSel}`
                : periodo === 'hoy' ? 'Ingresos de hoy'
                : periodo === 'anio' ? `Ingresos en ${anioSel}`
                : periodo === 'custom' ? tituloPersonalizado
                : 'Ingresos por día'}
            </h2>
            {graficaData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sin datos para este período</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={graficaData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="fecha"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    // Semana: los 7 días (interval 0). Mes: en pantallas angostas
                    // se muestra 1 de cada 4 días para que no se encimen; en anchas,
                    // 1 de cada 2. Otros períodos: densidad automática de Recharts.
                    interval={periodo === 'semana' || periodo === 'anio' ? 0 : periodo === 'mes' ? (esAngosto ? 3 : 1) : undefined}
                    tickFormatter={(v) =>
                      periodo === 'semana'
                        ? (esAngosto ? fmtDiaSemanaCorto(v) : fmtDiaSemana(v))
                        : periodo === 'mes'
                          ? String(fechaLocal(v).getDate())
                          : periodo === 'hoy'
                            ? `${fechaLocal(v).getDate()} de ${MESES[fechaLocal(v).getMonth()]}`
                            : periodo === 'anio'
                              ? MESES[fechaLocal(v).getMonth()].slice(0, 3)
                              : (() => { const d = fechaLocal(v); return `${d.getDate()}/${MESES[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(-2)}`; })()
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={(v) => `$${v}`}
                    width={60}
                    // Aire arriba: al menos $1,000 de tope y ~15% de margen sobre
                    // la barra más alta, redondeado hacia arriba a un paso acorde a
                    // la magnitud (para dejar aire parejo y números limpios en el
                    // eje en cualquier escala: día, semana, mes o año).
                    domain={[0, (dataMax) => {
                      const conAire = Math.max(1000, dataMax * 1.15);
                      const paso = Math.pow(10, Math.floor(Math.log10(conAire))) / 2;
                      return Math.ceil(conAire / paso) * paso;
                    }]}
                  />
                  <Tooltip content={<CustomTooltip periodo={periodo} />} />
                  {/* En "hoy" hay una sola barra: se le da un ancho fijo cómodo
                      para que no salga tan angosta. Los demás períodos, automático. */}
                  <Bar dataKey="total" fill="#16a34a" radius={[4, 4, 0, 0]} barSize={periodo === 'hoy' ? 106 : undefined} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Lista de notas */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Notas</h2>
            </div>
            {listaNotas.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                Sin notas en este período
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-3 text-left">Folio</th>
                        <th className="px-4 py-3 text-left">Fecha</th>
                        <th className="px-4 py-3 text-left">Estado</th>
                        <th className="px-4 py-3 text-left">Máquina</th>
                        <th className="px-4 py-3 text-right">Cargas</th>
                        <th className="px-4 py-3 text-right">Productos</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {notasPagina.map((nota) => (
                        <tr key={nota.id ?? nota.folio} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => navigate(`/notas/${nota.id}`)}
                              className="font-mono text-xs text-blue hover:text-blue-700 hover:underline underline-offset-2 transition-colors"
                            >
                              {nota.folio}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{fmtFecha(nota.fecha)}</td>
                          <td className="px-4 py-3"><EstadoBadge estado={nota.estado} /></td>
                          <td className="px-4 py-3 text-gray-600">{nota.maquina}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{nota.cargas}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{fmt(nota.total_productos)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(nota.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPaginas > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm">
                    <button
                      type="button"
                      onClick={() => setPaginaNotas(p => Math.max(1, p - 1))}
                      disabled={paginaSegura <= 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-gray-500">Página {paginaSegura} de {totalPaginas}</span>
                    <button
                      type="button"
                      onClick={() => setPaginaNotas(p => Math.min(totalPaginas, p + 1))}
                      disabled={paginaSegura >= totalPaginas}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Corte de caja */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Corte de caja</h2>
            </div>
            <div className="divide-y divide-gray-100">
              <div className="flex justify-between px-4 py-3 text-sm text-gray-600">
                <span>Total por cargas de lavado</span>
                <span>{fmt(data.corte.total_cargas)}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm text-gray-600">
                <span>Total por artículos vendidos</span>
                <span>{fmt(data.corte.total_productos)}</span>
              </div>
              <div className="flex justify-between px-4 py-3 text-sm text-gray-600">
                <span>Total ajustes</span>
                <span>{fmt(data.corte.total_ajustes)}</span>
              </div>
              <div className="flex justify-between px-4 py-4 text-base font-bold text-gray-900 bg-gray-50">
                <span>TOTAL GENERAL</span>
                <span className="text-lg">{fmt(data.corte.total_general)}</span>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
