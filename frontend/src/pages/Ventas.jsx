import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import SucursalBar from '../components/SucursalBar';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const fmt = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

const fmtFecha = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
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
  { id: 'mes',    label: 'Este mes' },
  { id: 'anio',   label: 'Este año' },
  { id: 'custom', label: 'Personalizado' },
];

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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-sm">
      <p className="font-medium text-gray-700">{fmtFecha(label)}</p>
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

  const anioActual = new Date().getFullYear();
  const [anioSel, setAnioSel] = useState(anioActual);
  const [aniosDisponibles, setAniosDisponibles] = useState([]);
  const [mostrarAnios, setMostrarAnios] = useState(false);
  const anioRef = useRef(null);

  useEffect(() => {
    if (periodo === 'custom' && (!desde || !hasta)) return;
    let activo = true;
    let url = `/ventas/resumen?periodo=${periodo}`;
    if (periodo === 'custom') url += `&desde=${desde}&hasta=${hasta}`;
    if (periodo === 'anio') url += `&year=${anioSel}`;
    api.get(url)
      .then(result => { if (activo) { setData(result); setError(null); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [periodo, desde, hasta, anioSel]);

  // Años disponibles para el selector (siempre incluye el año en curso).
  useEffect(() => {
    api.get('/ventas/anios').then(setAniosDisponibles).catch(() => {});
  }, []);
  const anios = useMemo(
    () => [...new Set([anioActual, ...aniosDisponibles])].sort((a, b) => b - a),
    [aniosDisponibles, anioActual]
  );

  // Cierra el selector de año al hacer clic fuera.
  useEffect(() => {
    if (!mostrarAnios) return;
    const onDown = (e) => {
      if (anioRef.current && !anioRef.current.contains(e.target)) setMostrarAnios(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mostrarAnios]);

  const listaNotas   = data?.lista_notas ?? [];
  const totalPaginas = Math.max(1, Math.ceil(listaNotas.length / NOTAS_POR_PAGINA));
  const paginaSegura = Math.min(paginaNotas, totalPaginas);
  const notasPagina  = listaNotas.slice((paginaSegura - 1) * NOTAS_POR_PAGINA, paginaSegura * NOTAS_POR_PAGINA);

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4">
          <h1 className="text-xl font-bold text-gray-800">Ventas</h1>
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-6 space-y-6">

      {/* Filtro de período */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            // El período "año" es un selector: muestra el año elegido y
            // despliega la lista de años disponibles.
            if (p.id === 'anio') {
              const activo = periodo === 'anio';
              return (
                <div key={p.id} ref={anioRef} className="relative">
                  <button
                    onClick={() => { setPeriodo('anio'); setPaginaNotas(1); setMostrarAnios(v => !v); }}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activo
                        ? 'bg-blue text-white'
                        : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Año: {anioSel}
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
                onClick={() => { setPeriodo(p.id); setPaginaNotas(1); setMostrarAnios(false); }}
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
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Ingresos por día</h2>
            {data.grafica.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sin datos para este período</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.grafica} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="fecha"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getDate()}/${d.getMonth() + 1}`;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickFormatter={(v) => `$${v}`}
                    width={60}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
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
