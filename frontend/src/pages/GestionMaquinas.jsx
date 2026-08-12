import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';

const ESTADO_CFG = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', clsActive: 'bg-green-600 text-white', dot: 'bg-green-500' },
  // "Reservada": libre pero apartada por otra nota abierta (no es un estado real
  // de la máquina, se deriva de `reservada` que devuelve el backend).
  reservada:     { label: 'Reservada',     cls: 'bg-amber-100 text-amber-700', clsActive: 'bg-amber-500 text-white', dot: 'bg-amber-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   clsActive: 'bg-blue-600 text-white',  dot: 'bg-blue-500'  },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     clsActive: 'bg-red-600 text-white',   dot: 'bg-red-500'   },
};

// Estado a mostrar: una máquina disponible pero apartada se muestra como Reservada.
const estadoVisual = (m) => (m.reservada ? 'reservada' : m.estado);

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const TIPOS = [
  { v: 'lavadora', label: 'Lavadora' },
  { v: 'secadora', label: 'Secadora' },
];

const TAMANOS = [
  { v: 'mediana', label: 'Mediana' },
  { v: 'jumbo',   label: 'Jumbo'   },
];

const CAPACIDADES = [
  { v: '20kg', label: '20kg' },
  { v: '35kg', label: '35kg' },
];

const FORM_INIT = { nombre: '', tipo: 'lavadora', tamano: 'mediana', capacidad: '20kg', modelo: '', mantenimiento: false, notas: '' };

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

// Ícono de lavadora (info/washing-machine.svg). El color se hereda con currentColor.
function WashingMachineIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 66 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M51.704 5.33331H14.3706C12.8979 5.33331 11.704 6.52722 11.704 7.99998V56C11.704 57.4727 12.8979 58.6666 14.3706 58.6666H51.704C53.1767 58.6666 54.3707 57.4727 54.3707 56V7.99998C54.3707 6.52722 53.1767 5.33331 51.704 5.33331Z" stroke="currentColor" strokeWidth="5.33333"/>
      <path d="M11.704 20.6667H54.3707" stroke="currentColor" strokeWidth="5.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M38.371 11.3336C39.4754 11.3338 40.371 12.2292 40.371 13.3336C40.3708 14.438 39.4753 15.3335 38.371 15.3336C37.2665 15.3336 36.3711 14.4381 36.371 13.3336C36.371 12.2291 37.2664 11.3336 38.371 11.3336Z" fill="currentColor" stroke="currentColor" strokeWidth="1.33333"/>
      <path d="M46.371 11.3336C47.4754 11.3338 48.371 12.2292 48.371 13.3336C48.3708 14.438 47.4753 15.3335 46.371 15.3336C45.2665 15.3336 44.3711 14.4381 44.371 13.3336C44.371 12.2291 45.2664 11.3336 46.371 11.3336Z" fill="currentColor" stroke="currentColor" strokeWidth="1.33333"/>
      <path d="M33.0373 49.3333C38.192 49.3333 42.3706 45.1546 42.3706 40C42.3706 34.8453 38.192 30.6667 33.0373 30.6667C27.8827 30.6667 23.704 34.8453 23.704 40C23.704 45.1546 27.8827 49.3333 33.0373 49.3333Z" stroke="currentColor" strokeWidth="5.33333"/>
    </svg>
  );
}

export default function GestionMaquinas() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  const [maquinas, setMaquinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [editandoId, setEditandoId] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState('');
  const [eliminando, setEliminando] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [accionesMenuId, setAccionesMenuId] = useState(null);
  const accionesMenuRef = useRef(null);

  useEffect(() => {
    api.get('/maquinas')
      .then(setMaquinas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (accionesMenuId == null) return;
    const onMouseDown = (e) => {
      if (accionesMenuRef.current && !accionesMenuRef.current.contains(e.target)) setAccionesMenuId(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [accionesMenuId]);

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
      tamano: m.tamano ?? tamano,
      capacidad: m.capacidad ?? '20kg',
      modelo: m.modelo ?? '',
      mantenimiento: m.estado === 'mantenimiento',
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
      const { tipo, tamano, mantenimiento, ...rest } = form;
      const payload = {
        ...rest,
        nombre: capitalizar(rest.nombre),
        tipo: tipoCompuesto(tipo, tamano),
        // Tamaño también como columna propia: en lavadoras espeja el tipo; en
        // secadoras es la única forma de guardarlo.
        tamano,
      };
      if (editandoId != null) {
        // Solo tocamos el estado cuando el toggle de mantenimiento implica un
        // cambio; así no interrumpimos una máquina que esté en uso.
        const original = maquinas.find(m => m.id === editandoId);
        if (mantenimiento) {
          payload.estado = 'mantenimiento';
        } else if (original?.estado === 'mantenimiento') {
          payload.estado = 'disponible';
        }
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

  const conteos = {
    todos: maquinas.length,
    ...Object.fromEntries(
      Object.keys(ESTADO_CFG).map(e => [e, maquinas.filter(m => estadoVisual(m) === e).length])
    ),
  };

  const filtradas = filtro === 'todos'
    ? maquinas
    : maquinas.filter(m => estadoVisual(m) === filtro);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100">
      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Gestión de máquinas</h1>
          <p className="text-sm text-gray-500">{maquinas.length} equipo(s) registrado(s)</p>
        </div>
        {esAdmin && (
          <button
            onClick={abrirModal}
            aria-label="Agregar máquina"
            className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="px-6 md:px-8 py-4 space-y-4">

      {/* Filtros por estado */}
      {maquinas.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setFiltro('todos')}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === 'todos'
                ? 'bg-blue text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            Todos: {conteos.todos}
          </button>
          {Object.entries(ESTADO_CFG).map(([estado, cfg]) => {
            const isActive = filtro === estado;
            return (
              <button
                key={estado}
                onClick={() => setFiltro(estado)}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? cfg.clsActive : cfg.cls
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : cfg.dot}`} />
                {cfg.label}: {conteos[estado]}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {maquinas.length === 0 && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No hay máquinas registradas</p>
        </div>
      )}

      {maquinas.length > 0 && filtradas.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No hay máquinas con este filtro</p>
        </div>
      )}

      {filtradas.length > 0 && (
        <div className="space-y-16 pt-6">
          {[
            { titulo: 'Lavadoras', items: filtradas.filter(m => m.tipo !== 'secadora') },
            { titulo: 'Secadoras', items: filtradas.filter(m => m.tipo === 'secadora') },
          ].map(grupo => grupo.items.length > 0 && (
            <section key={grupo.titulo} className="space-y-3">
              <h2 className="text-base font-bold text-gray-900">
                {grupo.titulo} <span className="text-gray-400 font-medium">({grupo.items.length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {grupo.items.map(m => {
            const cfg = ESTADO_CFG[estadoVisual(m)] ?? ESTADO_CFG.disponible;
            const { tipo, tamano } = descomponerTipo(m.tipo);
            const tipoLabel = tipo === 'lavadora' ? 'Lavadora' : 'Secadora';
            // Tamaño desde la columna propia (secadoras) o del tipo (lavadoras).
            const tamanoVal = m.tamano ?? (tipo === 'lavadora' ? tamano : null);
            const tamanoLabel = tamanoVal
              ? (tamanoVal === 'jumbo' ? 'Jumbo' : 'Mediana')
              : null;
            const borrando = eliminando === m.id;

            // Toda la tarjeta abre la información de uso de la máquina (igual que
            // la tarjeta de empleados abre su desempeño). Solo Admin, y con
            // soporte de teclado (Enter/Espacio).
            const verUso = () => navigate(`/gestion-maquinas/${m.id}/uso`);
            return (
              <div
                key={m.id}
                role={esAdmin ? 'button' : undefined}
                tabIndex={esAdmin ? 0 : undefined}
                onClick={esAdmin ? verUso : undefined}
                onKeyDown={esAdmin ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verUso(); }
                } : undefined}
                className={`relative bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col ${
                  esAdmin ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                }`}
              >
                {/* Menú de acciones (kebab) — solo Admin; no debe navegar */}
                {esAdmin && (
                <div
                  className="absolute top-3 right-3"
                  onClick={(e) => e.stopPropagation()}
                  ref={accionesMenuId === m.id ? accionesMenuRef : null}
                >
                  <button
                    type="button"
                    onClick={() => setAccionesMenuId(prev => prev === m.id ? null : m.id)}
                    aria-haspopup="true"
                    aria-expanded={accionesMenuId === m.id}
                    aria-label="Acciones"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>

                  {accionesMenuId === m.id && (
                    <div className="absolute right-0 mt-1 z-10 w-40 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => { setAccionesMenuId(null); editarMaquina(m); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAccionesMenuId(null); eliminarMaquina(m); }}
                        disabled={borrando}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                        {borrando ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </div>
                  )}
                </div>
                )}

                {/* Ícono */}
                <div className="flex justify-center pt-8 pb-5">
                  <WashingMachineIcon className="w-24 h-24 text-gray-300" />
                </div>

                {/* Info */}
                <p className="font-bold text-gray-900 text-lg leading-tight">{m.nombre}</p>
                <p className="text-sm text-gray-500 mt-1">{tipoLabel}</p>
                {tamanoLabel && <p className="text-sm text-gray-500">{tamanoLabel}</p>}
                {m.capacidad && <p className="text-sm text-gray-500">{m.capacidad}</p>}
                {m.modelo && <p className="text-sm text-gray-500">{m.modelo}</p>}

                {/* Estado (informativo) */}
                <div className="self-start mt-4">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full ${cfg.clsActive}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full bg-white ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                    {cfg.label}
                  </span>
                  {m.reservada && m.reservada_folio && (
                    <p className="text-xs text-amber-600 mt-1">Apartada por {m.reservada_folio}</p>
                  )}
                </div>
              </div>
            );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      </div>

      {/* Modal agregar máquina */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">
                {editandoId != null ? 'Editar máquina' : 'Agregar máquina'}
              </h2>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Capacidad <span className="text-red-500">*</span>
                </label>
                <select name="capacidad" value={form.capacidad} onChange={handleChange} className={INPUT_CLS}>
                  {CAPACIDADES.map(c => (
                    <option key={c.v} value={c.v}>{c.label}</option>
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

              {editandoId != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Mantenimiento</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.mantenimiento}
                    onClick={() => setForm(f => ({ ...f, mantenimiento: !f.mantenimiento }))}
                    className={`relative inline-flex h-[39px] w-[67px] items-center rounded-full transition-colors ${
                      form.mantenimiento ? 'bg-red-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-[34px] w-[34px] transform rounded-full bg-white shadow transition-transform ${
                        form.mantenimiento ? 'translate-x-[30px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </div>
              )}

              {editandoId != null && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Notas</label>
                  <textarea
                    name="notas" value={form.notas} onChange={handleChange} rows={4}
                    placeholder="Observaciones adicionales..."
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
              )}

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {formError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={cerrarModal}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={guardando}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
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
