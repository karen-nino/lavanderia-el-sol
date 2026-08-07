import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

// Íconos de entrada/salida para las filas de apertura y cierre del corte.
function IconEntrada({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
    </svg>
  );
}
function IconSalida({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3h12.75" />
    </svg>
  );
}

const fmtFechaHora = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
};

const fmtHora = (fecha) => {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
};

// Ej.: Lunes, 03 Ago 26
const fmtFechaCorta = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const diaSem = cap(d.toLocaleDateString('es-MX', { weekday: 'long' }));
  const dd = String(d.getDate()).padStart(2, '0');
  const mes = cap(d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''));
  const yy = String(d.getFullYear()).slice(-2);
  return `${diaSem}, ${dd} ${mes} ${yy}`;
};

// Lunes (inicio) de la semana a la que pertenece una fecha. Sirve de clave para
// agrupar el historial por semana.
const inicioSemana = (fecha) => {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return d;
};

// Encabezado de la sección de semana: rango lunes–domingo.
// Ej.: Semana del 03-09 de Agosto. Si cruza de mes, muestra ambos meses:
// Semana del 28 de Julio al 03 de Agosto.
const fmtSemanaHeader = (fecha) => {
  const lunes = inicioSemana(fecha);
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const dd = (d) => String(d.getDate()).padStart(2, '0');
  const mes = (d) => {
    const m = d.toLocaleDateString('es-MX', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  };
  return lunes.getMonth() === domingo.getMonth()
    ? `Semana del ${dd(lunes)}-${dd(domingo)} de ${mes(domingo)}`
    : `Semana del ${dd(lunes)} de ${mes(lunes)} al ${dd(domingo)} de ${mes(domingo)}`;
};

// Filtro de fecha del historial, con las mismas opciones que Ventas. El "mes"
// se elige de un dropdown (como el año), por eso no lleva etiqueta fija.
const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Mes' },
  { id: 'anio',   label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];

// Nombres de meses capitalizados (Enero … Diciembre).
const MESES = Array.from({ length: 12 }, (_, i) => {
  const m = new Date(2020, i, 1).toLocaleDateString('es-MX', { month: 'long' });
  return m.charAt(0).toUpperCase() + m.slice(1);
});

// Rango [desde, hasta) según el periodo elegido. null = sin filtro (p. ej.
// Personalizado sin fechas todavía). El mes se toma del año seleccionado.
const rangoDePeriodo = (periodo, anio, mes, desde, hasta) => {
  const ahora = new Date();
  const hoy0 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  switch (periodo) {
    case 'hoy':
      return { desde: hoy0, hasta: new Date(hoy0.getTime() + 86400000) };
    case 'semana': {
      const l = inicioSemana(ahora);
      const f = new Date(l); f.setDate(f.getDate() + 7);
      return { desde: l, hasta: f };
    }
    case 'mes':
      return { desde: new Date(anio, mes, 1), hasta: new Date(anio, mes + 1, 1) };
    case 'anio':
      return { desde: new Date(anio, 0, 1), hasta: new Date(anio + 1, 0, 1) };
    case 'custom': {
      if (!desde || !hasta) return null;
      const d = new Date(`${desde}T00:00:00`);
      const h = new Date(`${hasta}T00:00:00`); h.setDate(h.getDate() + 1);
      return { desde: d, hasta: h };
    }
    default:
      return null;
  }
};

const TABS = [
  { id: 'apertura',    label: 'Apertura' },
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'corte',       label: 'Corte' },
  { id: 'historial',   label: 'Historial' },
];

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
      {message}
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="text-sm text-gray-400 text-center py-10">{children}</p>;
}

// ── Apertura ────────────────────────────────────────────────
function Apertura({ data, onAbrir }) {
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (data?.abierta) {
    const { caja, totales } = data;
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-green-700">Caja abierta</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{fmt(caja.monto_inicial)}</p>
          <p className="mt-0.5 text-xs text-green-700/70">Fondo inicial</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
          <div className="flex justify-between px-4 py-3 text-gray-600">
            <span>Abierta por</span><span className="font-medium text-gray-800">{caja.usuario_apertura}</span>
          </div>
          <div className="flex justify-between px-4 py-3 text-gray-600">
            <span>Desde</span><span className="font-medium text-gray-800">{fmtFechaHora(caja.abierta_at)}</span>
          </div>
          <div className="flex justify-between px-4 py-3 text-gray-600">
            <span>Esperado en caja</span><span className="font-bold text-gray-900">{fmt(totales.esperado)}</span>
          </div>
        </div>
        {caja.notas_apertura && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Nota</p>
            <p className="mt-2.5 text-sm text-gray-800">{caja.notas_apertura}</p>
          </div>
        )}
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/abrir', { monto_inicial: Number(monto), notas });
      setMonto('');
      setNotas('');
      onAbrir();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <p className="text-sm text-gray-500">No hay una caja abierta. Ingresa el fondo inicial para abrirla.</p>
      <ErrorBox message={error} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Fondo inicial</label>
        <input
          type="number" min="0" step="0.01" required
          value={monto} onChange={(e) => setMonto(e.target.value)}
          placeholder="0.00"
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
        <textarea
          rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
        />
      </div>
      <button
        type="submit" disabled={saving}
        className="w-full bg-blue hover:bg-blue/90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
      >
        {saving ? 'Abriendo…' : 'Abrir caja'}
      </button>
    </form>
  );
}

// ── Movimientos ─────────────────────────────────────────────
function Movimientos({ data, onChange }) {
  const [tipo, setTipo] = useState('salida');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!data?.abierta) {
    return <EmptyState>Abre la caja primero para registrar movimientos.</EmptyState>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/movimientos', { tipo, concepto, monto: Number(monto) });
      setConcepto('');
      setMonto('');
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const movimientos = data.movimientos ?? [];

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4 max-w-md">
        <ErrorBox message={error} />
        <div className="flex gap-2">
          {[
            { id: 'salida',  label: 'Salida' },
            { id: 'entrada', label: 'Entrada' },
          ].map((t) => (
            <button
              key={t.id} type="button" onClick={() => setTipo(t.id)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tipo === t.id
                  ? (t.id === 'salida' ? 'bg-red-600 text-white' : 'bg-green-600 text-white')
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Concepto</label>
          <input
            type="text" required value={concepto} onChange={(e) => setConcepto(e.target.value)}
            placeholder="Ej. Compra de detergente"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
          <input
            type="number" min="0.01" step="0.01" required value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
        </div>
        <button
          type="submit" disabled={saving}
          className="w-full bg-blue hover:bg-blue/90 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Registrar movimiento'}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">Movimientos de la sesión</h2>
        </div>
        {movimientos.length === 0 ? (
          <EmptyState>Sin movimientos registrados.</EmptyState>
        ) : (
          <div className="divide-y divide-gray-100">
            {movimientos.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.concepto}</p>
                  <p className="text-xs text-gray-400">{m.usuario} · {fmtFechaHora(m.created_at)}</p>
                </div>
                <span className={`text-sm font-semibold ${m.tipo === 'salida' ? 'text-red-600' : 'text-green-600'}`}>
                  {m.tipo === 'salida' ? '−' : '+'}{fmt(m.monto)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Corte ───────────────────────────────────────────────────
function Corte({ data, onCerrar }) {
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!data?.abierta) {
    return <EmptyState>Abre la caja primero para hacer el corte.</EmptyState>;
  }

  const { caja, totales } = data;
  const contadoNum = Number(contado);
  const diferencia = contado === '' ? null : contadoNum - totales.esperado;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/caja/cerrar', { monto_contado: contadoNum, notas_cierre: notas });
      setContado('');
      setNotas('');
      onCerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const rows = [
    { label: 'Fondo inicial',   value: caja.monto_inicial, sign: '' },
    { label: 'Ventas cobradas', value: totales.ventas,     sign: '+' },
    { label: 'Entradas',        value: totales.entradas,   sign: '+' },
    { label: 'Salidas',         value: totales.salidas,    sign: '−' },
  ];

  return (
    <div className="space-y-6 max-w-md">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">Desglose esperado</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between px-4 py-3 text-sm text-gray-600">
              <span>{r.label}</span>
              <span>{r.sign}{fmt(r.value)}</span>
            </div>
          ))}
          <div className="flex justify-between px-4 py-4 text-base font-bold text-gray-900 bg-gray-50">
            <span>ESPERADO EN CAJA</span>
            <span className="text-lg">{fmt(totales.esperado)}</span>
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Efectivo contado</label>
          <input
            type="number" min="0" step="0.01" required value={contado} onChange={(e) => setContado(e.target.value)}
            placeholder="0.00"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
          />
        </div>
        {diferencia !== null && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
            Math.abs(diferencia) < 0.005
              ? 'bg-green-50 text-green-700'
              : 'bg-orange-50 text-orange-700'
          }`}>
            Diferencia: {diferencia > 0 ? '+' : ''}{fmt(diferencia)}
            {Math.abs(diferencia) < 0.005 ? ' (cuadra)' : (diferencia > 0 ? ' (sobrante)' : ' (faltante)')}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nota de cierre (opcional)</label>
          <textarea
            rows={4} value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base resize-y min-h-[6rem]"
          />
        </div>
        <button
          type="submit" disabled={saving}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60"
        >
          {saving ? 'Cerrando…' : 'Cerrar caja'}
        </button>
      </form>
    </div>
  );
}

// ── Historial ───────────────────────────────────────────────
function Historial({ onFiltroLabel }) {
  const [cortes, setCortes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtro de período, igual que en Ventas (con mes y año en dropdown).
  const [periodo, setPeriodo] = useState('hoy');
  const [anioSel, setAnioSel] = useState(() => new Date().getFullYear());
  const [mesSel, setMesSel] = useState(() => new Date().getMonth());
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [mostrarAnios, setMostrarAnios] = useState(false);
  const [mostrarMeses, setMostrarMeses] = useState(false);
  const anioRef = useRef(null);
  const mesRef = useRef(null);

  useEffect(() => {
    let activo = true;
    api.get('/caja/historial')
      .then((data) => { if (activo) setCortes(data ?? []); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

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

  // Etiqueta del filtro activo, para mostrarla como subtítulo del encabezado
  // (igual que en Ventas).
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
  useEffect(() => { onFiltroLabel?.(filtroLabel); }, [filtroLabel, onFiltroLabel]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (cortes.length === 0) return <EmptyState>Aún no hay cortes registrados.</EmptyState>;

  // Años disponibles a partir de los cortes (más el actual), de mayor a menor.
  const anios = [...new Set([new Date().getFullYear(), ...cortes.map((c) => new Date(c.cerrada_at).getFullYear())])]
    .sort((a, b) => b - a);

  const rango = rangoDePeriodo(periodo, anioSel, mesSel, desde, hasta);
  const visibles = rango
    ? cortes.filter((c) => {
        const f = new Date(c.cerrada_at);
        return f >= rango.desde && f < rango.hasta;
      })
    : cortes;

  // Se agrupan los cortes por semana (encabezado con el rango lunes–domingo),
  // respetando el orden en que llegan (más recientes primero).
  const grupos = [];
  for (const c of visibles) {
    const clave = inicioSemana(c.cerrada_at).getTime();
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.cortes.push(c);
    else grupos.push({ clave, titulo: fmtSemanaHeader(c.cerrada_at), cortes: [c] });
  }

  return (
    <div className="space-y-6">
      {/* Filtro de período (igual que Ventas): Hoy, Esta semana, Este mes,
          Este año (con selector) y Personalizado. */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            if (p.id === 'mes') {
              const activoMes = periodo === 'mes';
              return (
                <div key={p.id} ref={mesRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('mes'); setMostrarAnios(false); setMostrarMeses((v) => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activoMes ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
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
                          onClick={() => { setMesSel(i); setPeriodo('mes'); setMostrarMeses(false); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            mesSel === i ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
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
            if (p.id === 'anio') {
              const activoAnio = periodo === 'anio';
              return (
                <div key={p.id} ref={anioRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('anio'); setMostrarMeses(false); setMostrarAnios((v) => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activoAnio ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
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
                          onClick={() => { setAnioSel(y); setPeriodo('anio'); setMostrarAnios(false); }}
                          className={`block w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                            anioSel === y ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
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
                onClick={() => { setPeriodo(p.id); setMostrarAnios(false); setMostrarMeses(false); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  periodo === p.id ? 'bg-blue text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
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
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Hasta</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </div>
        )}
      </div>

      {visibles.length === 0 ? (
        <EmptyState>No hay cortes en este periodo.</EmptyState>
      ) : (
        <div className="space-y-8">
          {grupos.map((g) => (
            <div key={g.clave} className="space-y-3">
              <h3 className="text-sm font-bold text-dark-blue px-1">{g.titulo}</h3>
          {g.cortes.map((c) => {
            const cuadra = c.diferencia != null && Math.abs(c.diferencia) < 0.005;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-base font-semibold text-gray-800">{fmtFechaCorta(c.cerrada_at)}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{fmtHora(c.cerrada_at)}</p>
                  </div>
                  {c.diferencia != null && (
                    <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                      cuadra ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
                    }`}>
                      {cuadra ? 'Cuadra' : `${c.diferencia > 0 ? '+' : ''}${fmt(c.diferencia)}`}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-base">
                  <span className="text-gray-500">Fondo</span><span className="text-right text-gray-700">{fmt(c.monto_inicial)}</span>
                  <span className="text-gray-500">Ventas</span><span className="text-right text-gray-700">{fmt(c.ventas)}</span>
                  <span className="text-gray-500">Entradas</span><span className="text-right text-gray-700">{fmt(c.entradas)}</span>
                  <span className="text-gray-500">Salidas</span><span className="text-right text-gray-700">{fmt(c.salidas)}</span>
                  <span className="text-gray-500 font-medium">Esperado</span><span className="text-right font-medium text-gray-800">{fmt(c.esperado)}</span>
                  <span className="text-gray-500 font-medium">Contado</span><span className="text-right font-medium text-gray-800">{c.contado != null ? fmt(c.contado) : '—'}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 divide-y divide-gray-100">
                  <div className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 text-sm">
                      <IconEntrada className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-400 w-12">Abrió</span>
                      <span className="font-medium text-gray-700">{c.usuario_apertura}</span>
                    </div>
                    {c.notas_apertura && (
                      <p className="mt-2 ml-7 pl-3 border-l-2 border-gray-100 text-sm text-gray-500">{c.notas_apertura}</p>
                    )}
                  </div>
                  <div className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 text-sm">
                      <IconSalida className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-400 w-12">Cerró</span>
                      <span className="font-medium text-gray-700">{c.usuario_cierre ?? '—'}</span>
                    </div>
                    {c.notas_cierre && (
                      <p className="mt-2 ml-7 pl-3 border-l-2 border-gray-100 text-sm text-gray-500">{c.notas_cierre}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Caja() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  // El historial de cortes (con diferencias de caja) es solo para admins;
  // el endpoint también lo exige.
  // Para admins el Historial es lo más importante: va primero en las pestañas.
  // Los no-admins no ven Historial.
  const tabs = esAdmin
    ? [TABS.find((t) => t.id === 'historial'), ...TABS.filter((t) => t.id !== 'historial')]
    : TABS.filter((t) => t.id !== 'historial');

  // Se puede entrar directo a una pestaña con ?tab=... (ej. desde la tarjeta
  // de Corte del Dashboard, que enlaza a /caja?tab=corte). Sin ?tab, los admins
  // abren en Historial y los demás en Apertura.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const req = searchParams.get('tab');
    return tabs.some((t) => t.id === req) ? req : (esAdmin ? 'historial' : 'apertura');
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Menú de acciones (⋮) para admins: Apertura, Movimientos y Corte pasan aquí
  // como secundarias; el Historial es la página principal.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Etiqueta del filtro activo del Historial, reportada por ese componente,
  // para mostrarla como subtítulo del encabezado en esa pestaña.
  const [historialFiltro, setHistorialFiltro] = useState('');

  const fetchActual = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/caja/actual');
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let activo = true;
    api.get('/caja/actual')
      .then(result => { if (activo) { setData(result); setError(null); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

  // Tras abrir/cerrar caja conviene mostrar el estado más relevante.
  const handleAbrir = () => { fetchActual(); setTab('movimientos'); };
  const handleCerrar = () => { fetchActual(); setTab(esAdmin ? 'historial' : 'apertura'); };

  // Cierra el menú de acciones (⋮) al hacer clic fuera.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const seccionLabel = tabs.find((t) => t.id === tab)?.label ?? '';

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-3xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Caja</h1>
            {/* Para admins la página es el Historial; el subtítulo refleja el
                filtro activo en esa pestaña y la sección actual en las demás. */}
            {esAdmin && (
              <p className="text-sm text-gray-500 mt-0.5">
                {tab === 'historial' ? historialFiltro : seccionLabel}
              </p>
            )}
          </div>

          {/* Menú de acciones (⋮): Apertura / Movimientos / Corte como secundarias. */}
          {esAdmin && (
            <div ref={menuRef} className="relative flex-shrink-0">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Acciones de caja"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="w-10 h-10 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-12 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-1 w-44">
                  {TABS.filter((t) => t.id !== 'historial').map((t) => (
                    <button
                      key={t.id}
                      role="menuitem"
                      onClick={() => { setTab(t.id); setMenuOpen(false); }}
                      className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition-colors ${
                        tab === t.id ? 'bg-light-blue text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-6 space-y-6">

      {/* No-admins conservan las pestañas (no tienen Historial). */}
      {!esAdmin && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-blue text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Admins: al entrar a una sección secundaria, un enlace para volver. */}
      {esAdmin && tab !== 'historial' && (
        <button
          onClick={() => setTab('historial')}
          className="flex items-center gap-1.5 text-sm font-medium text-blue hover:opacity-80"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver al historial
        </button>
      )}

      {loading && tab !== 'historial' && <Spinner />}
      {error && tab !== 'historial' && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {tab === 'apertura'    && <Apertura data={data} onAbrir={handleAbrir} />}
          {tab === 'movimientos' && <Movimientos data={data} onChange={fetchActual} />}
          {tab === 'corte'       && <Corte data={data} onCerrar={handleCerrar} />}
        </>
      )}
      {tab === 'historial' && <Historial onFiltroLabel={setHistorialFiltro} />}
      </div>
    </div>
  );
}
