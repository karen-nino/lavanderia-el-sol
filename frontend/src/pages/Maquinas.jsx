import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const ESTADO_CFG = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
};

const TIPO_CFG = {
  lavadora_mediana: { label: 'Lavadora mediana', icon: '🫧' },
  lavadora_jumbo:   { label: 'Lavadora jumbo',   icon: '🫧' },
  secadora:         { label: 'Secadora',          icon: '🌀' },
};

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const FORM_INIT = { nombre: '', tipo: 'lavadora_mediana', modelo: '', notas: '' };

export default function Maquinas() {
  const [maquinas, setMaquinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState('');

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

  const abrirModal = () => { setForm(FORM_INIT); setFormError(''); setModalOpen(true); };
  const cerrarModal = () => setModalOpen(false);

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setFormError('');
    setGuardando(true);
    try {
      const nueva = await api.post('/maquinas', form);
      setMaquinas(prev => [...prev, nueva]);
      cerrarModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGuardando(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
          <p className="text-sm text-gray-500">{maquinas.length} equipo(s) registrado(s)</p>
        </div>
        <button
          onClick={abrirModal}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Agregar máquina
        </button>
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
            const tipoCfg = TIPO_CFG[m.tipo] ?? { label: m.tipo, icon: '🔧' };
            const busy = cambiando === m.id;
            const otrosEstados = Object.entries(ESTADO_CFG).filter(([e]) => e !== m.estado);

            return (
              <div key={m.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                {/* Encabezado */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl leading-none">{tipoCfg.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm leading-tight">{m.nombre}</p>
                      <p className="text-xs text-gray-400">{tipoCfg.label}</p>
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

      {/* Modal agregar máquina */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Agregar máquina</h2>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  name="nombre" required value={form.nombre} onChange={handleChange}
                  placeholder="Ej. Lavadora 1"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Tipo <span className="text-red-500">*</span>
                </label>
                <select name="tipo" value={form.tipo} onChange={handleChange} className={INPUT_CLS}>
                  {Object.entries(TIPO_CFG).map(([val, { label }]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Modelo</label>
                <input
                  name="modelo" value={form.modelo} onChange={handleChange}
                  placeholder="Ej. LG FH4U2VHN2"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Notas</label>
                <textarea
                  name="notas" value={form.notas} onChange={handleChange} rows={2}
                  placeholder="Observaciones adicionales..."
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={cerrarModal}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={guardando}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
