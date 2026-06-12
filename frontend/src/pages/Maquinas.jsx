import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const ESTADO_CFG = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
};

const TIPO_CFG = {
  lavadora_mediana: { label: 'Lavadora Mediana', icon: '🫧' },
  lavadora_jumbo:   { label: 'Lavadora Jumbo',   icon: '🫧' },
  secadora:         { label: 'Secadora',          icon: '🌀' },
};

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const TIPOS = [
  { v: 'lavadora', label: 'Lavadora' },
  { v: 'secadora', label: 'Secadora' },
];

const TAMANOS = [
  { v: 'mediana', label: 'Mediana' },
  { v: 'jumbo',   label: 'Jumbo'   },
];

const FORM_INIT = { nombre: '', tipo: 'lavadora', tamano: 'mediana', modelo: '', notas: '' };

const tipoCompuesto = (tipo, tamano) =>
  tipo === 'lavadora' ? `lavadora_${tamano}` : tipo;

const capitalizar = (s) => {
  const t = (s ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

const descomponerTipo = (tipoDb) => {
  if (tipoDb === 'lavadora_mediana') return { tipo: 'lavadora', tamano: 'mediana' };
  if (tipoDb === 'lavadora_jumbo')   return { tipo: 'lavadora', tamano: 'jumbo'   };
  return { tipo: 'secadora', tamano: 'mediana' };
};

export default function Maquinas() {
  const [maquinas, setMaquinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState('');
  const [eliminando, setEliminando] = useState(null);

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

  const abrirModal = () => {
    setForm(FORM_INIT);
    setEditandoId(null);
    setFormError('');
    setModalOpen(true);
  };

  const editarMaquina = (m) => {
    const { tipo, tamano } = descomponerTipo(m.tipo);
    setForm({
      nombre: m.nombre ?? '',
      tipo,
      tamano,
      modelo: m.modelo ?? '',
      notas:  m.notas ?? '',
    });
    setEditandoId(m.id);
    setFormError('');
    setModalOpen(true);
  };

  const cerrarModal = () => setModalOpen(false);

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setFormError('');
    setGuardando(true);
    try {
      const { tipo, tamano, ...rest } = form;
      const payload = {
        ...rest,
        nombre: capitalizar(rest.nombre),
        tipo: tipoCompuesto(tipo, tamano),
      };
      if (editandoId != null) {
        const actualizada = await api.put(`/maquinas/${editandoId}`, payload);
        setMaquinas(prev => prev.map(m => m.id === editandoId ? actualizada : m));
      } else {
        const nueva = await api.post('/maquinas', payload);
        setMaquinas(prev => [...prev, nueva]);
      }
      cerrarModal();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const eliminarMaquina = async (m) => {
    if (!confirm(`¿Eliminar la máquina "${m.nombre}"?`)) return;
    setEliminando(m.id);
    try {
      await api.delete(`/maquinas/${m.id}`);
      setMaquinas(prev => prev.filter(x => x.id !== m.id));
    } catch (err) {
      alert(err.message);
    } finally {
      setEliminando(null);
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
    <div className="pt-10 pb-16 px-6 md:py-14 md:px-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Máquinas</h1>
          <p className="text-sm text-gray-500">{maquinas.length} equipo(s) registrado(s)</p>
        </div>
        <button
          onClick={abrirModal}
          aria-label="Agregar máquina"
          className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M12 4v16m8-8H4" />
          </svg>
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
            const borrando = eliminando === m.id;
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

                {/* Editar / Eliminar */}
                <div className="flex gap-2 pt-3 mt-2 border-t border-gray-50">
                  <button
                    type="button"
                    onClick={() => editarMaquina(m)}
                    disabled={borrando}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminarMaquina(m)}
                    disabled={borrando}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                    {borrando ? 'Eliminando...' : 'Eliminar'}
                  </button>
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
              <h2 className="text-base font-semibold text-gray-900">
                {editandoId != null ? 'Editar máquina' : 'Agregar máquina'}
              </h2>
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
                  {TIPOS.map(t => (
                    <option key={t.v} value={t.v}>{t.label}</option>
                  ))}
                </select>
              </div>

              {form.tipo === 'lavadora' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Tamaño <span className="text-red-500">*</span>
                  </label>
                  <select name="tamano" value={form.tamano} onChange={handleChange} className={INPUT_CLS}>
                    {TAMANOS.map(t => (
                      <option key={t.v} value={t.v}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

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
                  name="notas" value={form.notas} onChange={handleChange} rows={4}
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
