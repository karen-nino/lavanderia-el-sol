import { useEffect, useRef, useState } from 'react';
import { api, mensajeDeError } from '../lib/api';
import { formatTelefono } from '../lib/telefono';
import { useAuth } from '../context/AuthContext';
import { esAdminMain as esAdminMainFn } from '../lib/roles';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const MOBILE_INPUT_CLS =
  'w-full px-4 py-3.5 border border-grey/30 rounded-lg text-base text-dark-blue placeholder-grey/60 focus:outline-none focus:border-blue transition';

// Botones +/- de los campos numéricos (mismo estilo que el paso de cargas en
// autoservicio), en tamaño desktop y móvil.
const STEP_BTN_CLS =
  'flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 text-lg font-semibold leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const STEP_BTN_CLS_M =
  'flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full border border-grey/30 bg-white text-dark-blue text-xl font-semibold leading-none hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

const ROL_LABEL = { admin_main: 'Admin Main', admin: 'Admin', operador: 'Empleado' };

const SectionIcon = {
  perfil: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  negocio: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6v6H9z" />
    </svg>
  ),
  // Signo de dólar (sin círculo), para "Cargas y Precios". viewBox acercado al
  // glifo para que se vea más grande, con el trazo ajustado a ese acercamiento.
  cargas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="5.5 5.5 13 13">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.1}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
    </svg>
  ),
  // Lavadora, igual que el icono de "Máquinas" del nav inferior.
  maquinas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2} />
      <circle cx="12" cy="13" r="4" strokeWidth={2} />
      <circle cx="8"  cy="6.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  alertas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  // Dos etiquetas (Lucide "tags"), acorde con "Etiquetas de encargo" (plural).
  etiquetas: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9.01V9" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19" />
    </svg>
  ),
  // Caja de inventario (Lucide "package").
  inventario: (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  ),
  gear: (
    <svg className="w-7 h-7 text-grey" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  back: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 19l-7-7 7-7" />
    </svg>
  ),
  imagePlaceholder: (
    <svg className="w-8 h-8 text-grey/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  eye: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  eyeOff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
    </svg>
  ),
};

const MOBILE_SECTIONS = [
  { id: 'perfil',  label: 'Mi Perfil',                 subtitle: 'Información de perfil',    icon: SectionIcon.perfil  },
  { id: 'negocio', label: 'Negocio y Sucursales',      subtitle: 'Información de sucursales', icon: SectionIcon.negocio },
  { id: 'maquinas', label: 'Máquinas',                  subtitle: 'Detalles de máquinas',      icon: SectionIcon.maquinas },
  { id: 'cargas',   label: 'Cargas y Precios',          subtitle: 'Topes de precio por carga', icon: SectionIcon.cargas },
  { id: 'alertas', label: 'Alertas y Notificaciones',  subtitle: 'Ajustes de alertas', icon: SectionIcon.alertas },
  { id: 'etiquetas', label: 'Etiquetas de encargo',    subtitle: 'Tipos de tela y tamaños de edredón', icon: SectionIcon.etiquetas },
  { id: 'inventario', label: 'Inventario',              subtitle: 'Marcas y envases de productos', icon: SectionIcon.inventario },
];

// Encabezado de un grupo de campos dentro de una sección. Va por encima de las
// etiquetas de campo (que son bold), porque antes se perdía entre ellas: iba en
// 12 px gris mientras cada campo pesaba más que el título de su propio grupo.
function TituloGrupo({ children }) {
  return <p className="text-sm font-bold text-dark-blue">{children}</p>;
}

// La escala de móvil es mayor (título de pantalla 20 px, etiqueta 16 px bold),
// así que ahí el encabezado de grupo va en 18 px.
function TituloGrupoMobile({ children }) {
  return <p className="text-lg font-bold text-dark-blue">{children}</p>;
}

// Tarjeta de móvil equivalente a Section: el encabezado con fondo separa el
// grupo de sus campos por estructura, no por tamaño de letra (las etiquetas de
// campo en móvil ya son de 16 px bold).
function TarjetaMobile({ titulo, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {titulo && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-base font-bold text-dark-blue">{titulo}</p>
        </div>
      )}
      <div className="px-4 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Section({ titulo, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-base font-bold text-dark-blue">{titulo}</h2>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function MobileField({ label, children, hint }) {
  return (
    <div className="space-y-2">
      <label className="block text-base font-bold text-dark-blue">{label}</label>
      {children}
      {hint && <p className="text-xs text-grey">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Fila con etiqueta + descripción a la izquierda y el toggle a la derecha.
function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function MobileSectionButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-5 bg-white rounded-card text-left shadow-sm"
    >
      <span className="text-blue flex items-center justify-center flex-shrink-0">{icon}</span>
      <span className="text-base font-medium text-dark-blue">{label}</span>
    </button>
  );
}

// Catálogo editable de etiquetas internas (tipos de tela, tamaños de edredón).
// Cada cambio se guarda de inmediato contra su endpoint; no depende del botón
// "Guardar" general de Ajustes. Las etiquetas se desactivan (no se borran) para
// que las notas viejas conserven su valor.
function CatalogoEtiquetas({ endpoint, singular, inputCls, onMensaje }) {
  const [items,      setItems]      = useState([]);
  const [nuevo,      setNuevo]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [confirmar,  setConfirmar]  = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [editNombre, setEditNombre] = useState('');
  const [savedId,    setSavedId]    = useState(null);

  // Reordenamiento con Pointer Events: funciona igual con mouse (desktop) y con
  // el dedo (touch/móvil), a diferencia del arrastre nativo del navegador.
  const listRef      = useRef(null);
  const dragIdRef    = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    api.get(endpoint).then(data => setItems(data ?? [])).catch(() => {});
  }, [endpoint]);

  // Guarda el nuevo orden (lista de ids) en el servidor.
  const persistirOrden = async (lista) => {
    try {
      await api.patch(`${endpoint}/reordenar`, { ids: lista.map(x => x.id) });
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  const onHandleDown = (e, id) => {
    if (e.button != null && e.button !== 0) return; // solo botón principal
    dragIdRef.current = id;
    setDraggingId(id);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // Al mover el puntero, se coloca el elemento arrastrado en la posición de la
  // fila que está debajo (según su posición vertical).
  const onHandleMove = (e) => {
    const id = dragIdRef.current;
    if (id == null || !listRef.current) return;
    const y = e.clientY;
    const filas = [...listRef.current.querySelectorAll('[data-row]')];
    const objetivo = filas.find(f => {
      const r = f.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (!objetivo) return;
    const targetId = Number(objetivo.getAttribute('data-row'));
    if (targetId === id) return;
    setItems(prev => {
      const from = prev.findIndex(x => x.id === id);
      const to   = prev.findIndex(x => x.id === targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const lista = [...prev];
      const [movido] = lista.splice(from, 1);
      lista.splice(to, 0, movido);
      return lista;
    });
  };

  const onHandleUp = (e) => {
    if (dragIdRef.current == null) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragIdRef.current = null;
    setDraggingId(null);
    setItems(prev => { persistirOrden(prev); return prev; });
  };

  // Se pide confirmación antes de agregar.
  const pedirAgregar = () => {
    if (!nuevo.trim()) return;
    setConfirmar(true);
  };

  const ejecutarAgregar = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setSaving(true);
    try {
      const creado = await api.post(endpoint, { nombre });
      setItems(prev => [...prev, creado]);
      setNuevo('');
      setConfirmar(false);
      // Confirmación como animación (palomita) en la fila recién agregada.
      setSavedId(creado.id);
      setTimeout(() => setSavedId(s => (s === creado.id ? null : s)), 1800);
    } catch (err) {
      setConfirmar(false);
      onMensaje?.({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const guardarNombre = async (id) => {
    const nombre = editNombre.trim();
    if (!nombre) return;
    try {
      const upd = await api.put(`${endpoint}/${id}`, { nombre });
      setItems(prev => prev.map(x => (x.id === id ? upd : x)));
      setEditId(null);
      // Confirmación como animación (palomita) en la fila, en vez de banner.
      setSavedId(id);
      setTimeout(() => setSavedId(s => (s === id ? null : s)), 1800);
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  const toggleActivo = async (item) => {
    try {
      const upd = await api.put(`${endpoint}/${item.id}`, { activo: !item.activo });
      setItems(prev => prev.map(x => (x.id === item.id ? upd : x)));
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };

  return (
    <>
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pedirAgregar(); } }}
          placeholder={`Agregar ${singular.toLowerCase()}`}
          className={inputCls}
        />
        <button
          type="button"
          onClick={pedirAgregar}
          disabled={saving || !nuevo.trim()}
          className="px-4 py-2.5 rounded-lg bg-blue text-white text-sm font-medium disabled:opacity-50 flex-shrink-0"
        >
          Agregar
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Aún no hay etiquetas.</p>
      ) : (
        <ul ref={listRef} className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {items.map((item) => (
            <li
              key={item.id}
              data-row={item.id}
              className={`flex items-center gap-2 px-3 py-2.5 bg-white ${draggingId === item.id ? 'opacity-40 ring-2 ring-blue/40 ring-inset' : ''}`}
            >
              {editId === item.id ? (
                <>
                  <input
                    type="text"
                    value={editNombre}
                    onChange={(e) => setEditNombre(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardarNombre(item.id); } }}
                    className={`${inputCls} flex-1`}
                    autoFocus
                  />
                  <button type="button" onClick={() => guardarNombre(item.id)}
                    className="text-sm font-medium text-blue px-2">Guardar</button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="text-sm text-gray-400 px-2">Cancelar</button>
                </>
              ) : (
                <>
                  <span
                    onPointerDown={(e) => onHandleDown(e, item.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    style={{ touchAction: 'none' }}
                    className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 -ml-1 p-1"
                    title="Arrastrar para reordenar"
                    aria-label="Arrastrar para reordenar"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
                    </svg>
                  </span>
                  <span className={`flex-1 text-sm ${item.activo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                    {item.nombre}
                  </span>
                  {savedId === item.id && (
                    <span className="flex items-center gap-1 text-green-600 text-xs font-medium animate-fade-in">
                      <IconoGuardado />
                      Guardado
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setEditId(item.id); setEditNombre(item.nombre); }}
                    className="text-sm text-gray-500 hover:text-blue px-2"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActivo(item)}
                    className={`text-sm px-2 ${item.activo ? 'text-gray-500 hover:text-red-600' : 'text-blue'}`}
                  >
                    {item.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>

    {/* Confirmación antes de agregar */}
    {confirmar && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-light-blue rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Agregar {singular.toLowerCase()}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                ¿Agregar <span className="font-medium text-gray-700">{nuevo.trim()}</span> a la lista?
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button" onClick={() => setConfirmar(false)} disabled={saving}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button" onClick={ejecutarAgregar} disabled={saving}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3 rounded-lg text-base transition-colors"
            >
              {saving ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Palomita animada (mismo trazo que el éxito de NuevaNota) para el estado
// "guardado" de los botones de Ajustes.
function IconoGuardado() {
  return (
    <svg className="w-5 h-5 animate-pop-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"
        style={{ strokeDasharray: 48, strokeDashoffset: 48 }} className="animate-draw-check" />
    </svg>
  );
}

// Contenido de un botón de guardar según su estado: cargando · guardado · reposo.
function ContenidoGuardar({ saving, ok, children, guardando = 'Guardando...', okLabel = '¡Guardado!' }) {
  if (saving) {
    return (
      <>
        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        {guardando}
      </>
    );
  }
  if (ok) return (<><IconoGuardado />{okLabel}</>);
  return children;
}

// Lista de sucursales reordenable por arrastre (Pointer Events: mouse y touch).
// Al soltar persiste el nuevo orden con PATCH /sucursales/reordenar { slugs }.
function SucursalesOrden({ sucursales, setSucursales, onMensaje }) {
  const listRef = useRef(null);
  const dragSlugRef = useRef(null);
  const [draggingSlug, setDraggingSlug] = useState(null);

  const persistir = async (lista) => {
    try {
      await api.patch('/sucursales/reordenar', { slugs: lista.map(s => s.slug) });
    } catch (err) {
      onMensaje?.({ tipo: 'error', texto: err.message });
    }
  };
  const onDown = (e, slug) => {
    if (e.button != null && e.button !== 0) return;
    dragSlugRef.current = slug;
    setDraggingSlug(slug);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onMove = (e) => {
    const slug = dragSlugRef.current;
    if (slug == null || !listRef.current) return;
    const y = e.clientY;
    const filas = [...listRef.current.querySelectorAll('[data-row]')];
    const objetivo = filas.find(f => {
      const r = f.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    if (!objetivo) return;
    const targetSlug = objetivo.getAttribute('data-row');
    if (targetSlug === slug) return;
    setSucursales(prev => {
      const from = prev.findIndex(x => x.slug === slug);
      const to   = prev.findIndex(x => x.slug === targetSlug);
      if (from === -1 || to === -1 || from === to) return prev;
      const lista = [...prev];
      const [movido] = lista.splice(from, 1);
      lista.splice(to, 0, movido);
      return lista;
    });
  };
  const onUp = (e) => {
    if (dragSlugRef.current == null) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    dragSlugRef.current = null;
    setDraggingSlug(null);
    setSucursales(prev => { persistir(prev); return prev; });
  };

  if (sucursales.length < 2) return null;
  return (
    <ul ref={listRef} className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
      {sucursales.map((s) => (
        <li
          key={s.slug}
          data-row={s.slug}
          className={`flex items-center gap-2 px-3 py-2.5 bg-white ${draggingSlug === s.slug ? 'opacity-40 ring-2 ring-blue/40 ring-inset' : ''}`}
        >
          <span
            onPointerDown={(e) => onDown(e, s.slug)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ touchAction: 'none' }}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 -ml-1 p-1"
            title="Arrastrar para reordenar"
            aria-label="Arrastrar para reordenar"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
            </svg>
          </span>
          <span className={`flex-1 text-sm ${s.activa ? 'text-gray-800' : 'text-gray-400'}`}>
            {s.nombre}{s.activa ? '' : ' (inactiva)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Ajustes() {
  const { usuario, updateUsuario, sucursalActiva } = useAuth();
  const [config,        setConfig]        = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview,   setLogoPreview]   = useState(null);
  const [mensaje,       setMensaje]       = useState(null);
  const [mobileSection, setMobileSection] = useState(null);
  const [perfilForm,    setPerfilForm]    = useState(() => ({
    nombre: usuario?.nombre ?? '',
    apellido: usuario?.apellido ?? '',
    password: '',
  }));
  const [showPassword, setShowPassword] = useState(false);
  // Clave del botón que acaba de guardar, para mostrarle la animación de palomita.
  const [guardadoOk, setGuardadoOk] = useState(null);
  const marcarGuardado = (clave) => {
    setGuardadoOk(clave);
    setTimeout(() => setGuardadoOk((actual) => (actual === clave ? null : actual)), 2200);
  };
  const logoInputRef = useRef(null);

  // Sucursales: cada una con su nombre, dirección y teléfono editables.
  // sucursalSel = slug de la sucursal que se está editando en el selector.
  const [sucursales,     setSucursales]     = useState([]);
  const [sucursalSel,    setSucursalSel]    = useState('');
  const [cambiandoActiva, setCambiandoActiva] = useState(null); // slug activándose/desactivándose
  const [agregando,      setAgregando]      = useState(false);
  const [creando,        setCreando]        = useState(false);
  const [nuevaSucursal,  setNuevaSucursal]  = useState({ nombre: '', direccion: '', telefono: '' });
  const [confirmarDesactivar, setConfirmarDesactivar] = useState(null); // sucursal a desactivar

  // Solo el Admin Main puede desactivar/reactivar sucursales.
  const esMain = esAdminMainFn(usuario?.rol);

  useEffect(() => {
    api.get('/ajustes')
      .then(data => {
        setConfig({ ...data, telefono: formatTelefono(data.telefono ?? '') });
        if (data.logo_url) setLogoPreview(data.logo_url);
      })
      .catch(e => setMensaje({ tipo: 'error', texto: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // ?todas=1 incluye inactivas para poder gestionarlas (reactivarlas).
    api.get('/sucursales?todas=1')
      .then(data => {
        const lista = (data ?? []).map(s => ({ ...s, telefono: formatTelefono(s.telefono ?? '') }));
        setSucursales(lista);
        // Arranca en la sucursal activa del admin, o en la primera.
        setSucursalSel(prev => prev || sucursalActiva || lista[0]?.slug || '');
      })
      .catch(() => {});
  }, [sucursalActiva]);

  const handleSucursalChange = (slug, field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setSucursales(prev => prev.map(s => s.slug === slug ? { ...s, [field]: next } : s));
  };

  // Valida y guarda la sucursal seleccionada. Devuelve la fila actualizada, o
  // null si no hay ninguna cargada. Lanza si el nombre está vacío o falla la API.
  // No maneja su propia animación de guardado: eso lo controla quien la llama
  // (ahora es "Guardar cambios"), para que la sucursal se guarde junto con lo demás.
  const patchSucursalActual = async () => {
    const s = sucursales.find(x => x.slug === sucursalSel);
    if (!s) return null;
    if (!String(s.nombre ?? '').trim()) {
      throw new Error('El nombre de la sucursal no puede estar vacío.');
    }
    const updated = await api.patch(`/sucursales/${s.slug}`, {
      nombre:    s.nombre,
      direccion: s.direccion ?? '',
      telefono:  s.telefono  ?? '',
    });
    setSucursales(prev => prev.map(x =>
      x.slug === updated.slug ? { ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
    ));
    return updated;
  };

  const handleNuevaChange = (field, value) => {
    const next = field === 'telefono' ? formatTelefono(value) : value;
    setNuevaSucursal(prev => ({ ...prev, [field]: next }));
  };

  const agregarSucursal = async () => {
    if (!nuevaSucursal.nombre.trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal es requerido.' });
    }
    setCreando(true);
    setMensaje(null);
    try {
      const creada = await api.post('/sucursales', {
        nombre:    nuevaSucursal.nombre.trim(),
        direccion: nuevaSucursal.direccion || '',
        telefono:  nuevaSucursal.telefono  || '',
      });
      const conFormato = { ...creada, telefono: formatTelefono(creada.telefono ?? '') };
      setSucursales(prev => [...prev, conFormato]);
      setSucursalSel(creada.slug);       // pasa a editar la recién creada
      setNuevaSucursal({ nombre: '', direccion: '', telefono: '' });
      setAgregando(false);
      marcarGuardado(`sucursal:${creada.slug}`);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCreando(false);
    }
  };

  const toggleActivaSucursal = async (slug, activa) => {
    setCambiandoActiva(slug);
    setMensaje(null);
    try {
      const updated = await api.patch(`/sucursales/${slug}/activa`, { activa });
      setSucursales(prev => prev.map(x =>
        x.slug === slug ? { ...x, ...updated, telefono: formatTelefono(updated.telefono ?? '') } : x
      ));
      setMensaje({
        tipo: 'ok',
        texto: `Sucursal "${updated.nombre}" ${activa ? 'reactivada' : 'desactivada'}.`,
      });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setCambiandoActiva(null);
    }
  };

  const confirmarDesactivarSucursal = async () => {
    if (!confirmarDesactivar) return;
    await toggleActivaSucursal(confirmarDesactivar.slug, false);
    setConfirmarDesactivar(null);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // El R.F.C. es texto libre (admite espacios y palabras), todo en mayúsculas.
    const next = name === 'telefono' ? formatTelefono(value)
      : name === 'rfc' ? value.toUpperCase()
      : value;
    setConfig(prev => ({ ...prev, [name]: next }));
  };

  // Suma/resta `delta` a un campo numérico (los botones +/-). Un campo vacío
  // cuenta como 0; no baja de `min`. Redondea a 2 decimales para evitar
  // arrastres de flotante (p. ej. 0.1 + 0.2).
  const stepCampo = (name, delta, min = 0) => {
    setConfig(prev => {
      const base = prev[name] === '' || prev[name] == null ? 0 : Number(prev[name]);
      let next = (Number.isFinite(base) ? base : 0) + delta;
      if (min != null && next < min) next = min;
      next = Math.round(next * 100) / 100;
      return { ...prev, [name]: String(next) };
    });
  };

  // Par de botones − / + para un campo, en tamaño desktop o móvil.
  const stepBtns = (name, step, min = 0, mobile = false) => {
    const cls = mobile ? STEP_BTN_CLS_M : STEP_BTN_CLS;
    return (
      <>
        <button type="button" aria-label="Disminuir" onClick={() => stepCampo(name, -step, min)} className={cls}>−</button>
        <button type="button" aria-label="Aumentar"  onClick={() => stepCampo(name,  step, min)} className={cls}>+</button>
      </>
    );
  };

  const handlePerfilChange = (e) => {
    const { name, value } = e.target;
    if (name === 'password' && perfilForm.password === '' && value.length > 0) {
      setShowPassword(true);
    }
    const next = name === 'telefono' ? formatTelefono(value) : value;
    setPerfilForm(prev => ({ ...prev, [name]: next }));
  };

  const handleGuardarPerfil = async (e) => {
    e.preventDefault();
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 8) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    setSaving(true);
    setMensaje(null);
    try {
      const payload = { nombre: perfilForm.nombre.trim(), apellido: perfilForm.apellido.trim() };
      if (perfilForm.password) payload.password = perfilForm.password;
      const updated = await api.patch('/auth/me', payload);
      updateUsuario({
        nombre: updated.nombre,
        apellido: updated.apellido,
        rol: updated.rol,
      });
      setPerfilForm(f => ({ ...f, password: '' }));
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitMobile = (e) => {
    if (mobileSection === 'perfil') return handleGuardarPerfil(e);
    if (mobileSection === 'negocio') return handleGuardarNegocioMobile(e);
    return handleGuardar(e);
  };

  // Guardado de la sección "Sucursales" en móvil con el botón "Guardar" del pie:
  // guarda tanto los datos del negocio (nombre_negocio; el logo va aparte) como
  // la sucursal seleccionada, en una sola acción.
  const handleGuardarNegocioMobile = async (e) => {
    e?.preventDefault();
    const s = sucursales.find(x => x.slug === sucursalSel);
    if (s && !String(s.nombre ?? '').trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal no puede estar vacío.' });
    }
    setSaving(true);
    setMensaje(null);
    try {
      const [updatedConfig] = await Promise.all([
        api.patch('/ajustes', buildConfigPayload()),
        patchSucursalActual(),
      ]);
      setConfig(updatedConfig);
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Topes de precio por carga: opcionales. Vacío = sin tope (null).
  const topeONull = (v) => (v === '' || v == null ? null : Number(v));

  // Payload de configuración del negocio para PATCH /ajustes. Se arma con el
  // estado completo de `config`, así que guardar desde cualquier sección envía
  // todos los campos (los no editados van con su valor actual).
  const buildConfigPayload = () => ({
    precio_carga_mediana:  Number(config.precio_carga_mediana),
    precio_carga_jumbo:    Number(config.precio_carga_jumbo),
    precio_carga_secadora: Number(config.precio_carga_secadora),
    precio_secadora_jumbo:   Number(config.precio_secadora_jumbo),
    precio_secadora_edredon: Number(config.precio_secadora_edredon),
    precio_edredon_jumbo:  Number(config.precio_edredon_jumbo),
    costo_empaquetado:     Number(config.costo_empaquetado) || 0,
    tope_carga_chico:      topeONull(config.tope_carga_chico),
    tope_carga_grande:     topeONull(config.tope_carga_grande),
    tope_carga_jumbo:      topeONull(config.tope_carga_jumbo),
    tope_carga_edredon:    topeONull(config.tope_carga_edredon),
    tiempo_carga_mediana:  Number(config.tiempo_carga_mediana),
    tiempo_carga_jumbo:    Number(config.tiempo_carga_jumbo),
    tiempo_edredon_jumbo:  Number(config.tiempo_edredon_jumbo),
    tiempo_carga_secadora: Number(config.tiempo_carga_secadora),
    tiempo_secadora_jumbo:   Number(config.tiempo_secadora_jumbo),
    tiempo_secadora_edredon: Number(config.tiempo_secadora_edredon),
    nombre_negocio:        config.nombre_negocio,
    rfc:                   config.rfc ?? '',
    stock_minimo_global:   Number(config.stock_minimo_global),
    alerta_ciclo_detenido: !!config.alerta_ciclo_detenido,
  });

  const handleGuardarTodo = async () => {
    const nombreCompleto = `${perfilForm.nombre} ${perfilForm.apellido}`.trim();
    if (!nombreCompleto) {
      return setMensaje({ tipo: 'error', texto: 'El nombre no puede estar vacío.' });
    }
    if (perfilForm.password && perfilForm.password.length < 8) {
      return setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    const sucursalActualEdit = sucursales.find(x => x.slug === sucursalSel);
    if (sucursalActualEdit && !String(sucursalActualEdit.nombre ?? '').trim()) {
      return setMensaje({ tipo: 'error', texto: 'El nombre de la sucursal no puede estar vacío.' });
    }

    setSaving(true);
    setMensaje(null);
    try {
      const perfilPayload = { nombre: perfilForm.nombre.trim(), apellido: perfilForm.apellido.trim() };
      if (perfilForm.password) perfilPayload.password = perfilForm.password;

      const [updatedPerfil, updatedConfig] = await Promise.all([
        api.patch('/auth/me', perfilPayload),
        api.patch('/ajustes', buildConfigPayload()),
        // La sucursal seleccionada se guarda junto con el resto. patchSucursalActual
        // actualiza su estado por dentro; su resultado no se necesita aquí.
        patchSucursalActual(),
      ]);

      updateUsuario({ nombre: updatedPerfil.nombre, apellido: updatedPerfil.apellido, rol: updatedPerfil.rol });
      setPerfilForm(f => ({ ...f, password: '' }));
      setConfig(updatedConfig);
      marcarGuardado('todo');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleGuardar = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setMensaje(null);
    try {
      const updated = await api.patch('/ajustes', buildConfigPayload());
      setConfig(updated);
      marcarGuardado('mobile');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploadingLogo(true);
    setMensaje(null);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ajustes/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        // Respuesta sin JSON (p. ej. el proxy rechaza el archivo por tamaño).
      }
      if (!res.ok) throw new Error(mensajeDeError(res.status, data));
      setConfig(prev => ({ ...prev, logo_url: data.logo_url }));
      setLogoPreview(data.logo_url);
      marcarGuardado('logo');
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  // Sucursal actualmente seleccionada para editar en el selector.
  const sucursalActual = sucursales.find(s => s.slug === sucursalSel) || null;

  // ── Desktop: secciones tipo card ──
  const seccionPerfilDesktop = (
    <Section titulo="Mi Perfil">
      <Field label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${INPUT_CLS} bg-gray-50 text-gray-500`}
        />
      </Field>

      <Field label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          className={INPUT_CLS}
        />
      </Field>

      <Field label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          className={INPUT_CLS}
        />
      </Field>

      <Field label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${INPUT_CLS} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </Field>
    </Section>
  );

  // Helpers de renglón (invocados como función, NO como <Componente/>, para
  // no remontar los inputs y perder el foco al teclear).
  const campoPrecio = (name, hint, required = true) => (
    <Field label="Precio por carga" hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 flex-shrink-0">$</span>
        <input
          type="number" name={name} min="0" step="0.01" required={required}
          value={config[name] ?? ''} onChange={handleChange} className={INPUT_CLS}
        />
        <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0)}
      </div>
    </Field>
  );
  const campoTiempo = (name, hint) => (
    <Field label="Tiempo de carga" hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number" name={name} min="1" step="1" required
          value={config[name] ?? ''} onChange={handleChange} className={INPUT_CLS}
        />
        <span className="text-sm text-gray-500 flex-shrink-0">min</span>
        {stepBtns(name, 1, 1)}
      </div>
    </Field>
  );
  const subTitulo = (txt) => <TituloGrupo>{txt}</TituloGrupo>;

  const seccionPreciosDesktop = (
    <>
    <Section titulo="Lavadora">
      {subTitulo('Mediana')}
      {campoPrecio('precio_carga_mediana', 'Aplica a lavadoras medianas en autoservicio y por encargo.')}
      {campoTiempo('tiempo_carga_mediana', 'Duración de un ciclo de lavado en una máquina mediana.')}

      <div className="border-t border-gray-100" />

      {subTitulo('Jumbo')}
      {campoPrecio('precio_carga_jumbo', 'Aplica a lavadoras jumbo en autoservicio y por encargo.')}
      {campoTiempo('tiempo_carga_jumbo', 'Duración de un ciclo de lavado en una máquina jumbo.')}

      <div className="border-t border-gray-100" />

      {subTitulo('Edredón')}
      {campoPrecio('precio_edredon_jumbo', 'Tarifa fija por edredón lavado en máquina jumbo.')}
      {campoTiempo('tiempo_edredon_jumbo', 'Duración del lavado de un edredón en máquina jumbo.')}
    </Section>

    <Section titulo="Secadora">
      {campoPrecio('precio_carga_secadora', 'Precio del secado de una carga.')}
      {campoTiempo('tiempo_carga_secadora', 'Duración del secado de una carga.')}
    </Section>
    </>
  );

  // Renglón de tope (opcional, vacío = sin tope) reutilizable.
  const campoTope = (name, label, tamano) => (
    <Field label={label} hint={`Precio máximo de una carga ${tamano} (máquinas + productos). Vacío = sin tope.`}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 flex-shrink-0">$</span>
        <input type="number" name={name} min="0" step="0.01"
          value={config[name] ?? ''} onChange={handleChange} className={INPUT_CLS} />
        <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0)}
      </div>
    </Field>
  );

  const seccionCargasPreciosDesktop = (
    <>
    <Section titulo="Tope de precio por carga">
      <p className="text-sm text-gray-500 -mt-1">
        Límite del precio de una carga (máquinas + productos) según su tamaño. El ajuste manual
        no cuenta contra el tope. Aplica a las cargas Por Encargo (que capturan tamaño).
      </p>
      <div className="space-y-8">
        {campoTope('tope_carga_chico',  'Carga Chica',  'chica')}
        {campoTope('tope_carga_grande', 'Carga Grande', 'grande')}
        {campoTope('tope_carga_jumbo',  'Carga Jumbo',  'jumbo')}
        {campoTope('tope_carga_edredon', 'Carga Edredón', 'de edredón')}
      </div>
    </Section>

    <div className="mt-10">
    <Section titulo="Empaquetado">
      <p className="text-sm text-gray-500 -mt-1">
        Costo del empaquetado de la ropa. Se incluye por defecto en cada carga Por Encargo
        (dentro del tope) y el empleado puede quitarlo por carga. Vacío o 0 = sin empaquetado.
      </p>
      <Field label="Costo del empaquetado">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 flex-shrink-0">$</span>
          <input type="number" name="costo_empaquetado" min="0" step="0.01"
            value={config.costo_empaquetado ?? ''} onChange={handleChange} className={INPUT_CLS} />
          <span className="text-sm text-gray-500 flex-shrink-0">MXN</span>
          {stepBtns('costo_empaquetado', 5, 0)}
        </div>
      </Field>
    </Section>
    </div>
    </>
  );

  const seccionSucursalesDesktop = (
    <Section titulo="Información de sucursales">
      {/* Datos globales del negocio (marca compartida) */}
      <TituloGrupo>Negocio (global)</TituloGrupo>
      <Field label="Nombre del negocio">
        <input
          type="text"
          name="nombre_negocio"
          required
          value={config.nombre_negocio ?? ''}
          onChange={handleChange}
          className={INPUT_CLS}
        />
      </Field>

      {/* R.F.C. del negocio: opcional */}
      <Field label="R.F.C.">
        <input
          type="text"
          name="rfc"
          value={config.rfc ?? ''}
          onChange={handleChange}
          placeholder="Opcional"
          className={INPUT_CLS}
        />
      </Field>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              SectionIcon.imagePlaceholder
            )}
          </div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-60 transition-colors ${
                guardadoOk === 'logo' ? 'border-green-300 text-green-700' : 'border-gray-300 text-gray-600'
              }`}
            >
              {uploadingLogo ? (
                <>
                  <div className="w-4 h-4 border-2 border-blue border-t-transparent rounded-full animate-spin" />
                  Subiendo...
                </>
              ) : guardadoOk === 'logo' ? (
                <>
                  <IconoGuardado />
                  Logo actualizado
                </>
              ) : (
                'Cambiar logo'
              )}
            </button>
            <p className="text-xs text-gray-400">JPG, PNG o WebP · Máx. 2 MB</p>
          </div>
        </div>
      </div>

      {/* Gestión de sucursales */}
      <div className="border-t border-gray-100 pt-8 mt-4 space-y-6">
        <div className="flex items-center justify-between">
          <TituloGrupo>Sucursales</TituloGrupo>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className={`flex-shrink-0 flex items-center gap-1.5 rounded-pill border-[1.5px] bg-white pl-2.5 pr-3.5 py-2 text-sm font-bold transition-colors ${
              agregando
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'border-blue text-blue hover:bg-light-blue'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d={agregando ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'}
              />
            </svg>
            {agregando ? 'Cancelar' : 'Agregar sucursal'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-3">
            <Field label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={agregarSucursal}
                disabled={creando}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creando ? 'Creando...' : 'Crear sucursal'}
              </button>
            </div>
          </div>
        )}

        <Field label="Sucursal a editar">
          <select
            value={sucursalSel}
            onChange={(e) => setSucursalSel(e.target.value)}
            className={`${INPUT_CLS} bg-white`}
          >
            {sucursales.map((s) => (
              <option key={s.slug} value={s.slug}>{s.nombre}{s.activa ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </Field>

        {sucursalActual && (
          <>
            <Field label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={INPUT_CLS}
              />
            </Field>
            {/* Los datos de la sucursal se guardan con "Guardar cambios" al pie.
                Aquí solo queda activar/desactivar (Admin Main). */}
            {esMain && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => sucursalActual.activa
                    ? setConfirmarDesactivar(sucursalActual)
                    : toggleActivaSucursal(sucursalActual.slug, true)}
                  disabled={cambiandoActiva === sucursalActual.slug}
                  className={`text-sm font-medium disabled:opacity-60 ${
                    sucursalActual.activa ? 'text-red hover:opacity-80' : 'text-green hover:opacity-80'
                  }`}
                >
                  {cambiandoActiva === sucursalActual.slug
                    ? 'Aplicando...'
                    : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
                </button>
              </div>
            )}
          </>
        )}

        <Field label="Orden de las sucursales" hint="Arrastra para cambiar cómo aparecen en el selector.">
          <SucursalesOrden sucursales={sucursales} setSucursales={setSucursales} onMensaje={setMensaje} />
        </Field>
      </div>
    </Section>
  );

  const seccionAlertasDesktop = (
    <Section titulo="Alertas y Notificaciones">
      <Field
        label="Unidades mínimas para alerta de stock bajo"
        hint="Los productos con stock igual o menor a este número se marcarán como 'Por agotarse'"
      >
        <input
          type="number"
          name="stock_minimo_global"
          min="0"
          step="1"
          required
          value={config.stock_minimo_global ?? ''}
          onChange={handleChange}
          className={INPUT_CLS}
        />
      </Field>

      <div className="border-t border-gray-100 pt-4">
        <ToggleRow
          label="Avisar cuando se detenga un ciclo"
          hint="Cuando alguien detenga una máquina con 'Detener ciclo', aparecerá una alerta en el Dashboard."
          checked={!!config.alerta_ciclo_detenido}
          onChange={(v) => setConfig(prev => ({ ...prev, alerta_ciclo_detenido: v }))}
        />
      </div>
    </Section>
  );

  const seccionEtiquetasDesktop = (
    <Section titulo="Etiquetas de encargo">
      <Field label="Tipos de tela" hint="Se ofrecen al crear un encargo de Ropa. Solo son etiquetas internas; no cambian el precio.">
        <CatalogoEtiquetas endpoint="/etiquetas/tipos-tela" singular="Tela" inputCls={INPUT_CLS} onMensaje={setMensaje} />
      </Field>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Tamaños de edredón" hint="Se ofrecen al crear un encargo de Edredón. Solo son etiquetas internas.">
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-edredon" singular="Tamaño" inputCls={INPUT_CLS} onMensaje={setMensaje} />
        </Field>
      </div>
    </Section>
  );

  const seccionInventarioDesktop = (
    <Section titulo="Inventario">
      <Field label="Marcas" hint="Se ofrecen al crear un producto. Desactivar una opción la quita de la lista sin afectar a los productos que ya la usan.">
        <CatalogoEtiquetas endpoint="/etiquetas/marcas-producto" singular="Marca" inputCls={INPUT_CLS} onMensaje={setMensaje} />
      </Field>
      <div className="border-t border-gray-100 pt-4">
        <Field label="Envases" hint="Se ofrecen al capturar el envase de un producto por tapa/medida.">
          <CatalogoEtiquetas endpoint="/etiquetas/envases-producto" singular="Envase" inputCls={INPUT_CLS} onMensaje={setMensaje} />
        </Field>
      </div>
    </Section>
  );

  // ── Mobile: contenido por sección ──
  const seccionPerfilMobile = (
    <div className="space-y-5">
      <MobileField label="Tipo de Cuenta">
        <input
          type="text"
          readOnly
          value={ROL_LABEL[usuario?.rol] ?? (usuario?.rol ?? '')}
          className={`${MOBILE_INPUT_CLS} bg-light-blue/20 text-grey`}
        />
      </MobileField>

      <MobileField label="Nombre">
        <input
          type="text"
          name="nombre"
          value={perfilForm.nombre}
          onChange={handlePerfilChange}
          className={MOBILE_INPUT_CLS}
        />
      </MobileField>

      <MobileField label="Apellido">
        <input
          type="text"
          name="apellido"
          value={perfilForm.apellido}
          onChange={handlePerfilChange}
          className={MOBILE_INPUT_CLS}
        />
      </MobileField>

      <MobileField label="Contraseña">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={perfilForm.password}
            onChange={handlePerfilChange}
            placeholder="••••••••"
            className={`${MOBILE_INPUT_CLS} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-grey hover:text-dark-blue"
          >
            {showPassword ? SectionIcon.eyeOff : SectionIcon.eye}
          </button>
        </div>
      </MobileField>
    </div>
  );

  const seccionSucursalesMobile = (
    <div className="space-y-14">
      {/* Datos globales del negocio (marca compartida) */}
      <div className="space-y-8">
        <TituloGrupoMobile>Negocio (global)</TituloGrupoMobile>
        <MobileField label="Nombre del Negocio">
          <input
            type="text"
            name="nombre_negocio"
            required
            value={config.nombre_negocio ?? ''}
            onChange={handleChange}
            className={MOBILE_INPUT_CLS}
          />
        </MobileField>

        {/* R.F.C. del negocio: opcional */}
        <MobileField label="R.F.C.">
          <input
            type="text"
            name="rfc"
            value={config.rfc ?? ''}
            onChange={handleChange}
            placeholder="Opcional"
            className={MOBILE_INPUT_CLS}
          />
        </MobileField>

        <MobileField label="Logo">
          <div className="border border-grey/30 rounded-lg p-4 flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border-2 border-dashed border-grey/40 bg-light-blue/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                SectionIcon.imagePlaceholder
              )}
            </div>
            <div className="flex-1 space-y-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className={`px-4 py-2 border rounded-lg text-sm bg-white disabled:opacity-60 flex items-center gap-2 ${
                  guardadoOk === 'logo' ? 'border-green-300 text-green-700' : 'border-grey/40 text-dark-blue'
                }`}
              >
                {uploadingLogo ? 'Subiendo...' : guardadoOk === 'logo' ? (
                  <>
                    <IconoGuardado />
                    Logo actualizado
                  </>
                ) : 'Cambiar logo'}
              </button>
              <p className="text-xs text-grey">JPG, PNG o WebP Max. 2 MB</p>
            </div>
          </div>
        </MobileField>
      </div>

      {/* Gestión de sucursales */}
      <div className="space-y-8 border-t border-light-blue/60 pt-10">
        <div className="flex items-center justify-between">
          <TituloGrupoMobile>Sucursales</TituloGrupoMobile>
          <button
            type="button"
            onClick={() => { setAgregando(a => !a); setMensaje(null); }}
            className={`flex-shrink-0 flex items-center gap-1.5 rounded-pill border-[1.5px] bg-white pl-2.5 pr-3.5 py-2 text-sm font-bold transition-colors ${
              agregando
                ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'border-blue text-blue hover:bg-light-blue'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d={agregando ? 'M6 18L18 6M6 6l12 12' : 'M12 4v16m8-8H4'}
              />
            </svg>
            {agregando ? 'Cancelar' : 'Agregar'}
          </button>
        </div>

        {agregando && (
          <div className="rounded-lg border border-blue/30 bg-light-blue/20 p-4 space-y-4">
            <MobileField label="Nombre de la nueva sucursal">
              <input
                type="text"
                value={nuevaSucursal.nombre}
                onChange={(e) => handleNuevaChange('nombre', e.target.value)}
                placeholder="Ej. Sucursal Centro"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={nuevaSucursal.direccion}
                onChange={(e) => handleNuevaChange('direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={nuevaSucursal.telefono}
                onChange={(e) => handleNuevaChange('telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <button
              type="button"
              onClick={agregarSucursal}
              disabled={creando}
              className="w-full py-3.5 rounded-lg bg-blue text-white text-base font-medium disabled:opacity-60"
            >
              {creando ? 'Creando...' : 'Crear sucursal'}
            </button>
          </div>
        )}

        <MobileField label="Sucursal a editar">
          <select
            value={sucursalSel}
            onChange={(e) => setSucursalSel(e.target.value)}
            className={`${MOBILE_INPUT_CLS} bg-white`}
          >
            {sucursales.map((s) => (
              <option key={s.slug} value={s.slug}>{s.nombre}{s.activa ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </MobileField>

        {sucursalActual && (
          <>
            <MobileField label="Nombre de la sucursal">
              <input
                type="text"
                value={sucursalActual.nombre ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'nombre', e.target.value)}
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Dirección">
              <input
                type="text"
                value={sucursalActual.direccion ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'direccion', e.target.value)}
                placeholder="Calle, número, colonia..."
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            <MobileField label="Teléfono">
              <input
                type="tel"
                value={sucursalActual.telefono ?? ''}
                onChange={(e) => handleSucursalChange(sucursalActual.slug, 'telefono', e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
                maxLength={12}
                placeholder="33-1234-5678"
                className={MOBILE_INPUT_CLS}
              />
            </MobileField>
            {/* Los datos de la sucursal se guardan con el botón "Guardar" del pie. */}
            {esMain && (
              <button
                type="button"
                onClick={() => sucursalActual.activa
                  ? setConfirmarDesactivar(sucursalActual)
                  : toggleActivaSucursal(sucursalActual.slug, true)}
                disabled={cambiandoActiva === sucursalActual.slug}
                className={`w-full py-3.5 rounded-lg text-base font-medium border disabled:opacity-60 ${
                  sucursalActual.activa
                    ? 'border-red/40 text-red'
                    : 'border-green/40 text-green'
                }`}
              >
                {cambiandoActiva === sucursalActual.slug
                  ? 'Aplicando...'
                  : sucursalActual.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
              </button>
            )}
          </>
        )}

        <MobileField label="Orden de las sucursales" hint="Arrastra para cambiar cómo aparecen en el selector.">
          <SucursalesOrden sucursales={sucursales} setSucursales={setSucursales} onMensaje={setMensaje} />
        </MobileField>
      </div>
    </div>
  );

  // Helpers de renglón móvil (invocados como función, no como <Componente/>).
  const campoPrecioM = (name, hint, required = true) => (
    <MobileField label="Precio por carga" hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-base text-grey flex-shrink-0">$</span>
        <input
          type="number" name={name} min="0" step="0.01" required={required}
          value={config[name] ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS}
        />
        <span className="text-base text-grey flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0, true)}
      </div>
    </MobileField>
  );
  const campoTiempoM = (name, hint) => (
    <MobileField label="Tiempo de carga" hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number" name={name} min="1" step="1" required
          value={config[name] ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS}
        />
        <span className="text-base text-grey flex-shrink-0">min</span>
        {stepBtns(name, 1, 1, true)}
      </div>
    </MobileField>
  );
  const seccionPreciosMobile = (
    <div className="space-y-10">
      <div className="space-y-6">
        <TituloGrupoMobile>Lavadora</TituloGrupoMobile>
        <div className="space-y-4">
        <TarjetaMobile titulo="Mediana">
          {campoPrecioM('precio_carga_mediana', 'Aplica a lavadoras medianas (autoservicio y por encargo).')}
          {campoTiempoM('tiempo_carga_mediana', 'Duración del ciclo de lavado en una máquina mediana.')}
        </TarjetaMobile>
        <TarjetaMobile titulo="Jumbo">
          {campoPrecioM('precio_carga_jumbo', 'Aplica a lavadoras jumbo (autoservicio y por encargo).')}
          {campoTiempoM('tiempo_carga_jumbo', 'Duración del ciclo de lavado en una máquina jumbo.')}
        </TarjetaMobile>
        <TarjetaMobile titulo="Edredón">
          {campoPrecioM('precio_edredon_jumbo', 'Tarifa fija por edredón lavado en máquina jumbo.')}
          {campoTiempoM('tiempo_edredon_jumbo', 'Duración del lavado de un edredón en máquina jumbo.')}
        </TarjetaMobile>
        </div>
      </div>

      <div className="border-t border-light-blue/60 pt-8 space-y-6">
        <TituloGrupoMobile>Secadora</TituloGrupoMobile>
        <TarjetaMobile>
          {campoPrecioM('precio_carga_secadora', 'Precio del secado de una carga.')}
          {campoTiempoM('tiempo_carga_secadora', 'Duración del secado de una carga.')}
        </TarjetaMobile>
      </div>
    </div>
  );

  const campoTopeM = (name, label, tamano) => (
    <MobileField label={label} hint={`Precio máximo de una carga ${tamano} (máquinas + productos). Vacío = sin tope.`}>
      <div className="flex items-center gap-2">
        <span className="text-base text-grey flex-shrink-0">$</span>
        <input type="number" name={name} min="0" step="0.01"
          value={config[name] ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS} />
        <span className="text-base text-grey flex-shrink-0">MXN</span>
        {stepBtns(name, 5, 0, true)}
      </div>
    </MobileField>
  );

  const seccionCargasPreciosMobile = (
    <div className="space-y-10">
      <div className="space-y-6">
        <div className="space-y-1.5">
          <TituloGrupoMobile>Tope de precio por carga</TituloGrupoMobile>
          <p className="text-sm text-grey">
            Límite del precio de una carga (máquinas + productos) según su tamaño. El ajuste manual
            no cuenta contra el tope. Aplica a las cargas Por Encargo (que capturan tamaño).
          </p>
        </div>
        <TarjetaMobile>
          {campoTopeM('tope_carga_chico',  'Carga Chica',  'chica')}
          {campoTopeM('tope_carga_grande', 'Carga Grande', 'grande')}
          {campoTopeM('tope_carga_jumbo',  'Carga Jumbo',  'jumbo')}
          {campoTopeM('tope_carga_edredon', 'Carga Edredón', 'de edredón')}
        </TarjetaMobile>
      </div>

      <div className="border-t border-light-blue/60 pt-8 space-y-6">
        <div className="space-y-1.5">
          <TituloGrupoMobile>Empaquetado</TituloGrupoMobile>
          <p className="text-sm text-grey">
            Costo del empaquetado de la ropa. Se incluye por defecto en cada carga Por Encargo
            (dentro del tope) y el empleado puede quitarlo por carga. Vacío o 0 = sin empaquetado.
          </p>
        </div>
        <TarjetaMobile>
          <MobileField label="Costo del empaquetado">
            <div className="flex items-center gap-2">
              <span className="text-base text-grey flex-shrink-0">$</span>
              <input type="number" name="costo_empaquetado" min="0" step="0.01"
                value={config.costo_empaquetado ?? ''} onChange={handleChange} className={MOBILE_INPUT_CLS} />
              <span className="text-base text-grey flex-shrink-0">MXN</span>
              {stepBtns('costo_empaquetado', 5, 0, true)}
            </div>
          </MobileField>
        </TarjetaMobile>
      </div>
    </div>
  );

  const seccionAlertasMobile = (
    <div className="space-y-6">
      <MobileField
        label="Unidades mínimas para alerta de stock bajo"
        hint="Los productos con stock igual o menor a este número se marcarán como 'Por agotarse'"
      >
        <input
          type="number"
          name="stock_minimo_global"
          min="0"
          step="1"
          required
          value={config.stock_minimo_global ?? ''}
          onChange={handleChange}
          className={MOBILE_INPUT_CLS}
        />
      </MobileField>

      <div className="border-t border-light-blue/60 pt-5">
        <ToggleRow
          label="Avisar cuando se detenga un ciclo"
          hint="Cuando alguien detenga una máquina con 'Detener ciclo', aparecerá una alerta en el Dashboard."
          checked={!!config.alerta_ciclo_detenido}
          onChange={(v) => setConfig(prev => ({ ...prev, alerta_ciclo_detenido: v }))}
        />
      </div>
    </div>
  );

  const seccionEtiquetasMobile = (
    <div className="space-y-6">
      <MobileField
        label="Tipos de tela"
        hint="Se ofrecen al crear un encargo de Ropa. Solo son etiquetas internas; no cambian el precio."
      >
        <CatalogoEtiquetas endpoint="/etiquetas/tipos-tela" singular="Tela" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} />
      </MobileField>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField
          label="Tamaños de edredón"
          hint="Se ofrecen al crear un encargo de Edredón. Solo son etiquetas internas."
        >
          <CatalogoEtiquetas endpoint="/etiquetas/tamanos-edredon" singular="Tamaño" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} />
        </MobileField>
      </div>
    </div>
  );

  const seccionInventarioMobile = (
    <div className="space-y-6">
      <MobileField
        label="Marcas"
        hint="Se ofrecen al crear un producto. Desactivar una opción la quita de la lista sin afectar a los productos que ya la usan."
      >
        <CatalogoEtiquetas endpoint="/etiquetas/marcas-producto" singular="Marca" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} />
      </MobileField>

      <div className="border-t border-light-blue/60 pt-5">
        <MobileField
          label="Envases"
          hint="Se ofrecen al capturar el envase de un producto por tapa/medida."
        >
          <CatalogoEtiquetas endpoint="/etiquetas/envases-producto" singular="Envase" inputCls={MOBILE_INPUT_CLS} onMensaje={setMensaje} />
        </MobileField>
      </div>
    </div>
  );

  const mobileSectionContent = {
    perfil:  seccionPerfilMobile,
    negocio: seccionSucursalesMobile,
    maquinas: seccionPreciosMobile,
    cargas: seccionCargasPreciosMobile,
    alertas: seccionAlertasMobile,
    etiquetas: seccionEtiquetasMobile,
    inventario: seccionInventarioMobile,
  };

  // Éxitos: banner verde en línea. Errores: modal (igual que autoservicio).
  const mensajeBanner = mensaje?.tipo === 'ok' && (
    <div className="rounded-lg px-4 py-3 text-sm bg-green-50 border border-green-200 text-green-700">
      {mensaje.texto}
    </div>
  );

  const errorModal = mensaje?.tipo === 'error' && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center space-y-5 animate-shake">
        <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center animate-pop-in">
          <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M6 6L18 18M18 6L6 18"
              style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
              className="animate-draw-x"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-gray-900">Ocurrió un error</h3>
          <p className="text-sm text-gray-500">{mensaje.texto}</p>
        </div>
        <button
          type="button"
          onClick={() => setMensaje(null)}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );

  const activeSection = MOBILE_SECTIONS.find((s) => s.id === mobileSection);

  return (
    <>
      {errorModal}

      {/* ── Vista móvil ── */}
      <div className="md:hidden min-h-full bg-gray-50">
        {!activeSection ? (
          <>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex flex-col items-start">
                <div className='flex flex-row items-center gap-1'>
                  {SectionIcon.gear}
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">Ajustes</h1>
                </div>
                <p className="text-sm text-grey">Pantalla de ajustes</p>
              </div>
            </div>
            <div className="px-6 py-6 space-y-3">
              {MOBILE_SECTIONS.map((s) => (
                <MobileSectionButton
                  key={s.id}
                  label={s.label}
                  icon={s.icon}
                  onClick={() => setMobileSection(s.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmitMobile}>
            <div className="bg-white border-b-2 border-gray-200">
              <div className="px-6 pt-10 pb-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileSection(null)}
                  aria-label="Volver"
                  className="w-11 h-11 rounded-pill border border-grey/40 text-dark-blue flex items-center justify-center flex-shrink-0 transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
                >
                  {SectionIcon.back}
                </button>
                <div>
                  <h1 className="text-xl font-bold text-dark-blue leading-tight">{activeSection.label}</h1>
                  <p className="text-sm text-grey">{activeSection.subtitle}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6">
            {mobileSectionContent[activeSection.id]}

            {activeSection.id !== 'etiquetas' && activeSection.id !== 'inventario' && (
            <div className="grid grid-cols-2 gap-3 pt-8">
              <button
                type="button"
                onClick={() => setMobileSection(null)}
                className="border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || guardadoOk === 'mobile'}
                className={`${guardadoOk === 'mobile' ? 'bg-green-600' : 'bg-blue hover:opacity-90'} disabled:opacity-100 text-white font-medium py-3.5 rounded-lg text-base transition-colors flex items-center justify-center gap-2`}
              >
                <ContenidoGuardar saving={saving} ok={guardadoOk === 'mobile'}>Guardar</ContenidoGuardar>
              </button>
            </div>
            )}
            {mensajeBanner}
            </div>
          </form>
        )}
      </div>

      <input
        ref={logoInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleLogoSelect}
        className="hidden"
      />

      {/* ── Vista desktop ── */}
      <div className="hidden md:block min-h-full bg-gray-50">
        {/* Cabecera (barra superior) */}
        <div className="bg-white border-b-2 border-gray-200">
          <div className="max-w-2xl mx-auto px-6 pt-14 pb-4">
            <h1 className="text-xl font-bold text-gray-900">Ajustes</h1>
          </div>
        </div>

        {/* Contenido */}
        <div className="max-w-2xl mx-auto p-6 space-y-6">

        <div className="space-y-6">
          {seccionPerfilDesktop}
        </div>

        <div className="space-y-6">
          {seccionPreciosDesktop}
          {seccionCargasPreciosDesktop}
          {seccionSucursalesDesktop}
          {seccionAlertasDesktop}
          {seccionEtiquetasDesktop}
          {seccionInventarioDesktop}
        </div>

        <div className="space-y-3">
          {mensajeBanner}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleGuardarTodo}
              disabled={saving || guardadoOk === 'todo'}
              className={`flex items-center gap-2 px-6 py-3.5 ${guardadoOk === 'todo' ? 'bg-green-600' : 'bg-blue hover:opacity-90'} disabled:opacity-100 disabled:cursor-not-allowed text-white text-base font-medium rounded-lg transition-colors`}
            >
              <ContenidoGuardar saving={saving} ok={guardadoOk === 'todo'} okLabel="¡Guardado!">Guardar cambios</ContenidoGuardar>
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Confirmación para desactivar una sucursal (solo Admin Main) */}
      {confirmarDesactivar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 text-center mb-1">Desactivar sucursal</h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                ¿Seguro que quieres desactivar{' '}
                <span className="font-medium text-gray-700">{confirmarDesactivar.nombre}</span>?
                Dejará de aparecer en la operación, pero su historial (notas, caja y ventas) se conserva
                y podrás reactivarla después.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmarDesactivar(null)}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarDesactivarSucursal}
                  disabled={cambiandoActiva === confirmarDesactivar.slug}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {cambiandoActiva === confirmarDesactivar.slug ? 'Desactivando...' : 'Desactivar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
