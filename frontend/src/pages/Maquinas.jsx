import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const ESTADO_CFG = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
};

const TIPO_ICON = {
  lavadora:    '🫧',
  secadora:    '🌀',
  planchadora: '♨️',
};

export default function Maquinas() {
  const [maquinas, setMaquinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState(null);

  useEffect(() => {
    api.get('/maquinas')
      .then(setMaquinas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const cambiarEstado = async (id, estado) => {
    setCambiando(id);
    try {
      const updated = await api.patch(`/maquinas/${id}/estado`, { estado });
      setMaquinas(prev => prev.map(m => m.id === id ? updated : m));
    } catch (err) {
      alert(err.message);
    } finally {
      setCambiando(null);
    }
  };

  const resumen = Object.keys(ESTADO_CFG).map(e => ({
    estado: e,
    count: maquinas.filter(m => m.estado === e).length,
    cfg: ESTADO_CFG[e],
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
        <p className="text-sm text-gray-500">{maquinas.length} equipo(s) registrado(s)</p>
      </div>

      {/* Resumen estados */}
      {maquinas.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {resumen.map(({ estado, count, cfg }) => (
            <div key={estado} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${cfg.cls}`}>
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
              {cfg.label}: {count}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {maquinas.length === 0 && !error ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No hay máquinas registradas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {maquinas.map(m => {
            const cfg = ESTADO_CFG[m.estado] ?? ESTADO_CFG.disponible;
            const busy = cambiando === m.id;
            const otrosEstados = Object.entries(ESTADO_CFG).filter(([e]) => e !== m.estado);

            return (
              <div key={m.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                {/* Encabezado */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl leading-none">{TIPO_ICON[m.tipo] ?? '🔧'}</span>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm leading-tight">{m.nombre}</p>
                      <p className="text-xs text-gray-400 capitalize">{m.tipo}</p>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${cfg.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                    {cfg.label}
                  </span>
                </div>

                {m.modelo && (
                  <p className="text-xs text-gray-400 mb-3">Modelo: {m.modelo}</p>
                )}

                {/* Cambiar estado */}
                <div className="flex gap-1.5 flex-wrap pt-2 border-t border-gray-50">
                  {otrosEstados.map(([estado, c]) => (
                    <button
                      key={estado}
                      disabled={busy}
                      onClick={() => cambiarEstado(m.id, estado)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-opacity disabled:opacity-50 ${c.cls} border-current/30`}
                    >
                      {busy ? '...' : `→ ${c.label}`}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
