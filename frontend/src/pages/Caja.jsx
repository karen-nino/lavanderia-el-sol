import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

const fmtFechaHora = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
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
          <p className="text-sm text-gray-500">Nota: {caja.notas_apertura}</p>
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
        <input
          type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
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
          <input
            type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base"
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
function Historial() {
  const [cortes, setCortes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    api.get('/caja/historial')
      .then((data) => { if (activo) setCortes(data ?? []); })
      .catch((e) => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (cortes.length === 0) return <EmptyState>Aún no hay cortes registrados.</EmptyState>;

  return (
    <div className="space-y-3">
      {cortes.map((c) => {
        const cuadra = c.diferencia != null && Math.abs(c.diferencia) < 0.005;
        return (
          <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{fmtFechaHora(c.cerrada_at)}</p>
                <p className="text-xs text-gray-400">
                  Cerró {c.usuario_cierre ?? '—'} · Abrió {c.usuario_apertura}
                </p>
              </div>
              {c.diferencia != null && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  cuadra ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
                }`}>
                  {cuadra ? 'Cuadra' : `${c.diferencia > 0 ? '+' : ''}${fmt(c.diferencia)}`}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-500">Fondo</span><span className="text-right text-gray-700">{fmt(c.monto_inicial)}</span>
              <span className="text-gray-500">Ventas</span><span className="text-right text-gray-700">{fmt(c.ventas)}</span>
              <span className="text-gray-500">Entradas</span><span className="text-right text-gray-700">{fmt(c.entradas)}</span>
              <span className="text-gray-500">Salidas</span><span className="text-right text-gray-700">{fmt(c.salidas)}</span>
              <span className="text-gray-500 font-medium">Esperado</span><span className="text-right font-medium text-gray-800">{fmt(c.esperado)}</span>
              <span className="text-gray-500 font-medium">Contado</span><span className="text-right font-medium text-gray-800">{c.contado != null ? fmt(c.contado) : '—'}</span>
            </div>
            {c.notas_cierre && <p className="mt-2 text-xs text-gray-500">Nota: {c.notas_cierre}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function Caja() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  // El historial de cortes (con diferencias de caja) es solo para admins;
  // el endpoint también lo exige.
  const tabs = esAdmin ? TABS : TABS.filter((t) => t.id !== 'historial');

  const [tab, setTab] = useState('apertura');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-3xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4">
          <h1 className="text-xl font-bold text-gray-800">Caja</h1>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-6 space-y-6">

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

      {loading && tab !== 'historial' && <Spinner />}
      {error && tab !== 'historial' && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {tab === 'apertura'    && <Apertura data={data} onAbrir={handleAbrir} />}
          {tab === 'movimientos' && <Movimientos data={data} onChange={fetchActual} />}
          {tab === 'corte'       && <Corte data={data} onCerrar={handleCerrar} />}
        </>
      )}
      {tab === 'historial' && <Historial />}
      </div>
    </div>
  );
}
