import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
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

const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

function Tarjeta({ titulo, valor, sub, color }) {
  const colores = {
    azul:    'bg-blue-50 border-blue-200 text-blue-700',
    verde:   'bg-green-50 border-green-200 text-green-700',
    morado:  'bg-purple-50 border-purple-200 text-purple-700',
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
      <p className="text-indigo-600 font-semibold">{fmt(payload[0].value)}</p>
    </div>
  );
}

export default function Ventas() {
  const [periodo, setPeriodo] = useState('hoy');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (periodo === 'custom' && (!desde || !hasta)) return;
    setLoading(true);
    setError(null);
    try {
      let url = `/ventas/resumen?periodo=${periodo}`;
      if (periodo === 'custom') url += `&desde=${desde}&hasta=${hasta}`;
      const result = await api.get(url);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [periodo, desde, hasta]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800">Ventas</h1>

      {/* Filtro de período */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                periodo === p.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {periodo === 'custom' && (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
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
              titulo="Órdenes pagadas"
              valor={data.tarjetas.ordenes_pagadas}
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
              valor={data.tarjetas.ordenes_pendientes}
              sub="órdenes con saldo"
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

          {/* Lista de órdenes */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Órdenes pagadas</h2>
            </div>
            {data.lista_ordenes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                Sin órdenes en este período
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Folio</th>
                      <th className="px-4 py-3 text-left">Fecha</th>
                      <th className="px-4 py-3 text-left">Máquina</th>
                      <th className="px-4 py-3 text-right">Cargas</th>
                      <th className="px-4 py-3 text-right">Productos</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.lista_ordenes.map((orden) => (
                      <tr key={orden.folio} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{orden.folio}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtFecha(orden.fecha)}</td>
                        <td className="px-4 py-3 text-gray-600">{orden.maquina}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{orden.cargas}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{fmt(orden.total_productos)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(orden.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
  );
}
