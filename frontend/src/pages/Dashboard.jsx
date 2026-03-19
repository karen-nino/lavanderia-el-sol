import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const BADGE = {
  RECIBIDO:   { label: 'Recibido',   cls: 'bg-yellow-100 text-yellow-800' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-blue-100 text-blue-800' },
  LISTO:      { label: 'Listo',      cls: 'bg-green-100 text-green-800' },
  ENTREGADO:  { label: 'Entregado',  cls: 'bg-gray-100 text-gray-500' },
};

function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [ordenes, setOrdenes] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/ordenes'), api.get('/maquinas'), api.get('/insumos')])
      .then(([o, m, i]) => { setOrdenes(o); setMaquinas(m); setInsumos(i); })
      .finally(() => setLoading(false));
  }, []);

  const activas   = ordenes.filter(o => ['RECIBIDO', 'EN_PROCESO'].includes(o.estado)).length;
  const enUso     = maquinas.filter(m => m.estado === 'en_uso').length;
  const stockBajo = insumos.filter(i => Number(i.stock_actual) <= Number(i.stock_minimo)).length;
  const recientes = ordenes.slice(0, 6);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen del día</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Órdenes activas"
          value={activas}
          sub="Recibido + En proceso"
          color="text-indigo-600"
          icon="📋"
        />
        <StatCard
          label="Máquinas en uso"
          value={`${enUso} / ${maquinas.length}`}
          sub={maquinas.length === 0 ? 'Sin máquinas' : 'equipos en total'}
          color="text-blue-600"
          icon="🌀"
        />
        <StatCard
          label="Stock bajo"
          value={stockBajo}
          sub={stockBajo > 0 ? 'Artículos por reabastecer' : 'Inventario en orden'}
          color={stockBajo > 0 ? 'text-red-600' : 'text-green-600'}
          icon={stockBajo > 0 ? '⚠️' : '✅'}
        />
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Órdenes recientes</h2>
          <Link to="/ordenes" className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Ver todas →
          </Link>
        </div>
        {recientes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-400 text-sm">No hay órdenes registradas</p>
            <Link
              to="/ordenes/nueva"
              className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Crear primera orden
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recientes.map(o => {
              const badge = BADGE[o.estado] ?? BADGE.RECIBIDO;
              return (
                <div key={o.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800 font-mono">
                      {o.folio ?? `#${o.id}`}
                    </p>
                    <p className="text-xs text-gray-400">{o.cliente_nombre}</p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
