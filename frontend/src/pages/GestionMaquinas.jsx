import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import { estadoVisual, contarPorEstado, filtrarPorEstado } from '../lib/estadoMaquina';
import SucursalBar from '../components/SucursalBar';
import ConfirmacionModal from '../components/ConfirmacionModal';
import Selector from '../components/Selector';
import { ES_DEMO } from '../lib/entorno';

/** En la demo no hay Sonoff: se esconden la pastilla, el ID y el Encender. */
const CON_SONOFF = !ES_DEMO;

const ESTADO_CFG = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', clsActive: 'bg-green-600 text-white', dot: 'bg-green-500' },
  // "Reservada": libre pero asignada a otra nota abierta (lo deriva el backend).
  reservada:     { label: 'Reservada',     cls: 'bg-amber-100 text-amber-700', clsActive: 'bg-amber-500 text-white', dot: 'bg-amber-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   clsActive: 'bg-blue-600 text-white',  dot: 'bg-blue-500'  },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     clsActive: 'bg-red-600 text-white',   dot: 'bg-red-500'   },
};

/**
 * Pastilla del enlace Sonoff en la tarjeta: aquí se asignan los Device ID, así
 * que se ve de un vistazo cuáles faltan. 'sin_probar' = capturado pero sin
 * verificar.
 */
const SONOFF_CFG = {
  enlazada:    { label: 'Sonoff OK',    cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  error:       { label: 'Sin conexión', cls: 'bg-red-50 text-red-700 border-red-200',       dot: 'bg-red-500'   },
  sin_probar:  { label: 'Sin probar',   cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  sin_enlazar: { label: 'Sin Sonoff',   cls: 'bg-gray-50 text-gray-500 border-gray-200',    dot: 'bg-gray-400'  },
};

/** Texto bajo la pastilla: el motivo del último fallo o qué significa el estado. */
const sonoffExplicacion = (m) => {
  // Ocupada sin nota: alguien la prendió a mano (botón o eWeLink).
  if (m.encendida_manual_at && !m.en_uso_folio) {
    return 'Encendida a mano, sin nota. Queda ocupada hasta que la apagues.';
  }
  if (!m.device_id) return 'Esta máquina no tiene un Sonoff asignado: no enciende ni apaga sola.';
  if (m.sonoff_estado === 'error') {
    return m.sonoff_detalle || 'La última orden al Sonoff no llegó. Prueba el enlace para ver por qué.';
  }
  if (m.sonoff_estado === 'sin_probar') return 'Falta probar el enlace con este Sonoff.';
  return null;
};

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

const FORM_INIT = { nombre: '', tipo: 'lavadora', tamano: 'mediana', marca: '', capacidad: '20kg', modelo: '', mantenimiento: false, notas: '', device_id: '', device_canal: '' };

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

/** Ícono de lavadora; el color se hereda con currentColor. */
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
  const [encendiendo, setEncendiendo] = useState(null);
  const [probando, setProbando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [probarMsg, setProbarMsg] = useState(null); // { tipo: 'ok'|'error'|'sim', texto }
  const [desconectando, setDesconectando] = useState(false);
  // Acción esperando confirmación: { tipo: 'encender'|'eliminar'|'desconectar', maquina? }.
  const [porConfirmar, setPorConfirmar] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [cuentaSonoff, setCuentaSonoff] = useState(null);
  const [conectando, setConectando] = useState(false);
  const [accionesMenuId, setAccionesMenuId] = useState(null);
  const accionesMenuRef = useRef(null);
  // Catálogos de marcas y modelos (se administran en Ajustes → Máquinas).
  const [marcas, setMarcas] = useState([]);
  const [modelos, setModelos] = useState([]);

  useEffect(() => {
    api.get('/maquinas')
      .then(setMaquinas)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Catálogos del negocio. Los modelos se traen todos y se filtran por marca.
  // Si fallan, los selectores quedan vacíos.
  useEffect(() => {
    api.get('/etiquetas/marcas-maquina').then(setMarcas).catch(() => setMarcas([]));
    api.get('/etiquetas/modelos-maquina').then(setModelos).catch(() => setModelos([]));
  }, []);

  // Estado de la cuenta de eWeLink (sin ella ningún Sonoff obedece). Solo para
  // admin; useCallback para poder ponerla en las dependencias de los efectos.
  const cargarCuentaSonoff = useCallback(() => {
    if (!esAdmin) return;
    api.get('/ewelink/estado').then(setCuentaSonoff).catch(() => setCuentaSonoff(null));
  }, [esAdmin]);

  useEffect(() => { cargarCuentaSonoff(); }, [cargarCuentaSonoff]);

  // El apagado de emergencia solo con el driver real (lo dice /ewelink/estado):
  // en simulación se creería que se cortó una máquina que sigue girando.
  const mostrarApagadoEmergencia = Boolean(cuentaSonoff) && !cuentaSonoff.simulado;

  // Autorizar ocurre en la pestaña de eWeLink: al volver se pregunta de nuevo.
  useEffect(() => {
    if (!esAdmin) return;
    const onFocus = () => cargarCuentaSonoff();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [esAdmin, cargarCuentaSonoff]);

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
    setProbarMsg(null);
    setModalOpen(true);
  };

  const editarMaquina = (m) => {
    const { tipo, tamano } = descomponerTipo(m.tipo);
    setForm({
      nombre: m.nombre ?? '',
      tipo,
      tamano: m.tamano ?? tamano,
      capacidad: m.capacidad ?? '20kg',
      marca:  m.marca  ?? '',
      modelo: m.modelo ?? '',
      mantenimiento: m.estado === 'mantenimiento',
      notas:  m.notas ?? '',
      device_id: m.device_id ?? '',
      device_canal: m.device_canal ?? '',
    });
    setEditandoId(m.id);
    setFormError('');
    setProbarMsg(null);
    setModalOpen(true);
  };

  const cerrarModal = () => setModalOpen(false);

  // Si falla una acción de Sonoff, el backend manda la máquina con su error:
  // se recoge para que la tarjeta lo muestre sin recargar.
  const refrescarDesdeError = (err, id) => {
    if (err?.data?.maquina) setMaquinas(prev => prev.map(m => m.id === id ? err.data.maquina : m));
  };

  // Prueba el enlace guardado (no cambia la máquina). `id` explícito para probar
  // justo después de guardar.
  const handleProbar = async (id = editandoId) => {
    if (id == null) return;
    setProbando(true);
    setProbarMsg(null);
    try {
      const r = await api.post(`/maquinas/${id}/probar-sonoff`, {});
      if (r?.maquina) setMaquinas(prev => prev.map(m => m.id === id ? r.maquina : m));
      // En simulación un "ok" no prueba nada.
      setProbarMsg(r?.simulado
        ? { tipo: 'sim', texto: r.message }
        : { tipo: 'ok', texto: r?.message ?? 'Sonoff enlazado correctamente.' });
    } catch (err) {
      refrescarDesdeError(err, id);
      setProbarMsg({ tipo: 'error', texto: err.message });
    } finally {
      setProbando(false);
    }
  };

  // Conectar la cuenta: se abre en otra pestaña la URL firmada del servidor (una
  // redirección perdería el token del header).
  const handleConectarSonoff = async () => {
    setConectando(true);
    try {
      const r = await api.post('/ewelink/conectar', {});
      window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    } finally {
      setConectando(false);
    }
  };

  // La advertencia la pone el modal.
  const handleDesconectarSonoff = async () => {
    setDesconectando(true);
    try {
      await api.post('/ewelink/desconectar', {});
      cargarCuentaSonoff();
    } catch (err) {
      setError(err.message);
    } finally {
      setDesconectando(false);
    }
  };

  // Apagado de emergencia, sin confirmación: apagar de más no rompe nada.
  const handleApagarYa = async () => {
    if (editandoId == null) return;
    setApagando(true);
    setProbarMsg(null);
    try {
      const r = await api.post(`/maquinas/${editandoId}/apagar-sonoff`, {});
      if (r?.maquina) setMaquinas(prev => prev.map(m => m.id === editandoId ? r.maquina : m));
      setProbarMsg(r?.simulado
        ? { tipo: 'sim', texto: r.message }
        : { tipo: 'ok', texto: r?.message ?? 'Orden de apagado enviada.' });
    } catch (err) {
      refrescarDesdeError(err, editandoId);
      setProbarMsg({ tipo: 'error', texto: err.message });
    } finally {
      setApagando(false);
    }
  };

  // Marcas activas, más la de la máquina que se edita aunque ya no esté.
  const marcasVisibles = marcas.filter(m => m.activo);
  const marcaFueraDeLista = Boolean(form.marca) && !marcasVisibles.some(m => m.nombre === form.marca);

  // Modelos de la marca, del mismo tipo y tamaño; desactivados no, salvo el de
  // esta máquina. Se cruzan por nombre.
  const modelosVisibles = form.marca
    ? modelos.filter(mo => (
        mo.marca === form.marca && mo.activo
        && mo.tipo === form.tipo && mo.tamano === form.tamano
      ))
    : [];
  const modeloFueraDeLista = Boolean(form.modelo) && !modelosVisibles.some(mo => mo.nombre === form.modelo);
  // Apagado si no hay nada que elegir, salvo que la máquina ya traiga modelo.
  const modeloBloqueado = modelosVisibles.length === 0 && !form.modelo;
  // Modelo de fichas: no lleva Sonoff.
  const modeloDeFichas = Boolean(form.modelo) && modelos.some(mo => (
    mo.marca === form.marca && mo.nombre === form.modelo && mo.solo_fichas
  ));

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  // Cambiar marca, tipo o tamaño limpia el modelo.
  const handleCambioConModelo = e =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value, modelo: '' }));

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
        // Tamaño como columna: en lavadoras espeja el tipo; en secadoras es su único lugar.
        tamano,
      };
      const deviceIdNuevo = (rest.device_id ?? '').trim();
      let idResultante = editandoId;
      let hayDeviceIdNuevo = false;

      if (editandoId != null) {
        // El estado solo se toca si cambia el mantenimiento (no se interrumpe una en uso).
        const original = maquinas.find(m => m.id === editandoId);
        if (mantenimiento) {
          payload.estado = 'mantenimiento';
        } else if (original?.estado === 'mantenimiento') {
          payload.estado = 'disponible';
        }
        hayDeviceIdNuevo = deviceIdNuevo !== '' && deviceIdNuevo !== (original?.device_id ?? '');
        const actualizada = await api.put(`/maquinas/${editandoId}`, payload);
        setMaquinas(prev => prev.map(m => m.id === editandoId ? actualizada : m));
      } else {
        const nueva = await api.post('/maquinas', payload);
        setMaquinas(prev => [...prev, nueva]);
        idResultante = nueva.id;
        hayDeviceIdNuevo = deviceIdNuevo !== '';
      }

      // Con un Sonoff recién asignado se prueba solo y el modal muestra el resultado.
      if (hayDeviceIdNuevo) {
        setEditandoId(idResultante);
        await handleProbar(idResultante);
      } else {
        cerrarModal();
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  // Encendido manual (el modal advierte que se queda andando).
  const encenderMaquina = async (m) => {
    setEncendiendo(m.id);
    try {
      const r = await api.post(`/maquinas/${m.id}/encender-sonoff`, {});
      if (r?.maquina) setMaquinas(prev => prev.map(x => x.id === m.id ? r.maquina : x));
      alert(r?.message ?? 'Orden de encendido enviada.');
    } catch (err) {
      refrescarDesdeError(err, m.id);
      alert(err.message);
    } finally {
      setEncendiendo(null);
    }
  };

  const eliminarMaquina = async (m) => {
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

  // Advertencia de cada acción, según cómo esté la máquina ahora.
  const avisoDe = ({ tipo, maquina }) => tipo === 'desconectar' ? {
    tono: 'peligro',
    titulo: 'Olvidar la cuenta de eWeLink',
    mensaje: 'Las máquinas dejan de encender y apagar solas hasta que se conecte otra vez.',
    puntos: [
      'Mientras tanto hay que prenderlas y apagarlas a mano: la app no va a mover los relés.',
      'Las notas se cobran igual; lo que se pierde es el control de los Sonoff.',
      'Para volver, hay que autorizar la cuenta otra vez desde este mismo botón.',
    ],
    textoConfirmar: desconectando ? 'Olvidando…' : 'Olvidar cuenta',
    procesando: desconectando,
  } : tipo === 'encender' ? {
    tono: 'aviso',
    titulo: `Encender ${maquina.nombre}`,
    mensaje: 'La máquina arranca de verdad y se queda encendida hasta que la apagues.',
    puntos: [
      'Mientras esté encendida queda ocupada: no se va a poder usar en una nota.',
      'Asegúrate de que nadie la esté cargando ni tenga las manos dentro.',
    ],
    textoConfirmar: encendiendo === maquina.id ? 'Encendiendo…' : 'Encender',
    procesando: encendiendo === maquina.id,
  } : {
    tono: 'peligro',
    titulo: `Eliminar ${maquina.nombre}`,
    mensaje: 'La máquina desaparece del sistema y esto no se puede deshacer.',
    puntos: [
      // nota_cargas apunta a la máquina con ON DELETE SET NULL.
      'Las notas que la usaron, incluso las ya cerradas, dejan de decir en qué máquina se lavó.',
      maquina.estado === 'en_uso'
        && 'Ahora mismo está en uso: la nota que la tiene se queda sin máquina asignada.',
    ],
    textoConfirmar: eliminando === maquina.id ? 'Eliminando…' : 'Eliminar',
    procesando: eliminando === maquina.id,
  };

  const conteos = {
    todos: maquinas.length,
    ...contarPorEstado(maquinas, Object.keys(ESTADO_CFG)),
  };

  const filtradas = filtrarPorEstado(maquinas, filtro);

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
        <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
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
      <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

      {/* Cuenta de eWeLink: sin ella ningún Sonoff responde. Oculta en simulación. */}
      {esAdmin && CON_SONOFF && cuentaSonoff && !cuentaSonoff.simulado && (
        cuentaSonoff.conectada ? (
          <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2.5">
            <p className="text-sm text-gray-600">
              <span className="text-green-600 font-medium">✓ Cuenta de eWeLink conectada</span>
              {cuentaSonoff.cuenta && <span className="text-gray-400"> · {cuentaSonoff.cuenta}</span>}
            </p>
            <button
              type="button" onClick={() => setPorConfirmar({ tipo: 'desconectar' })}
              disabled={desconectando}
              className="text-sm font-medium text-gray-500 hover:text-red-600 disabled:opacity-60 transition-colors flex-shrink-0"
            >
              {desconectando ? 'Desconectando…' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Falta conectar la cuenta de eWeLink</p>
            <p className="mt-0.5 text-sm text-amber-800">
              {cuentaSonoff.configurado
                ? 'Mientras no se conecte, las máquinas con Sonoff no van a encender ni apagar.'
                : 'Faltan las credenciales de eWeLink en el servidor (EWELINK_APP_ID y EWELINK_APP_SECRET).'}
            </p>
            {cuentaSonoff.configurado && (
              <>
                <button
                  type="button" onClick={handleConectarSonoff} disabled={conectando}
                  className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 disabled:opacity-60 transition-colors"
                >
                  {conectando ? 'Abriendo…' : 'Conectar cuenta de eWeLink'}
                </button>
                <p className="mt-1.5 text-xs text-amber-700">
                  Se abre la página de eWeLink en otra pestaña. Inicia sesión con la cuenta
                  donde están dados de alta los Sonoff y acepta el permiso.
                </p>
              </>
            )}
          </div>
        )
      )}

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
              {/* Las que quepan (3 en la columna de celular); abajo de 352 px, fijo 2. */}
              <div className="grid grid-cols-2 min-[352px]:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
                {grupo.items.map(m => {
            const cfg = ESTADO_CFG[estadoVisual(m)] ?? ESTADO_CFG.disponible;
            const { tipo, tamano } = descomponerTipo(m.tipo);
            const tipoLabel = tipo === 'lavadora' ? 'Lavadora' : 'Secadora';
            // El tamaño también en secadoras: decide su precio, su tiempo y sus modelos.
            const tamanoVal = m.tamano ?? tamano;
            const tamanoLabel = tamanoVal
              ? (tamanoVal === 'jumbo' ? 'Jumbo' : 'Mediana')
              : null;
            const borrando = eliminando === m.id;
            const prendiendo = encendiendo === m.id;
            // La pastilla siempre (aquí se enlazan), salvo en modelos de fichas.
            const sonoffCfg = m.solo_fichas ? null
              : SONOFF_CFG[m.device_id ? (m.sonoff_estado ?? 'sin_probar') : 'sin_enlazar'];

            // La tarjeta abre la información de uso (solo admin, también con teclado).
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
                      {/* La de fichas no tiene Sonoff que encender. */}
                      {CON_SONOFF && !m.solo_fichas && (
                      <button
                        type="button"
                        onClick={() => { setAccionesMenuId(null); setPorConfirmar({ tipo: 'encender', maquina: m }); }}
                        disabled={prendiendo}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v9m6.36-6.36a9 9 0 11-12.72 0" />
                        </svg>
                        {prendiendo ? 'Encendiendo…' : 'Encender'}
                      </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setAccionesMenuId(null); setPorConfirmar({ tipo: 'eliminar', maquina: m }); }}
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
                {(m.marca || m.modelo) && (
                  <p className="text-sm text-gray-500">{[m.marca, m.modelo].filter(Boolean).join(' \u00b7 ')}</p>
                )}

                {/* Estado (informativo) */}
                <div className="self-start mt-4">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full ${cfg.clsActive}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full bg-white ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                    {cfg.label}
                  </span>
                  {m.reservada && m.reservada_folio && (
                    <p className="text-xs text-amber-600 mt-1">
                      Apartada por{' '}
                      {m.reservada_nota_id ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/notas/${m.reservada_nota_id}`); }}
                          className="font-semibold underline underline-offset-2 hover:text-amber-700"
                        >
                          {m.reservada_folio}
                        </button>
                      ) : m.reservada_folio}
                    </p>
                  )}
                  {esAdmin && CON_SONOFF && sonoffCfg && (
                    <div className="mt-2">
                      <span
                        title={m.device_id ? `Sonoff ${m.device_id}` : 'Sin Sonoff asignado'}
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${sonoffCfg.cls}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${sonoffCfg.dot}`} />
                        {sonoffCfg.label}
                      </span>
                      {/* El porqué, en texto: la pastilla sola no distingue la causa. */}
                      {sonoffExplicacion(m) && (
                        <p className="mt-1 text-[11px] leading-snug text-gray-500">{sonoffExplicacion(m)}</p>
                      )}
                    </div>
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

      {/* Advertencia de encender y de eliminar */}
      {porConfirmar && (
        <ConfirmacionModal
          {...avisoDe(porConfirmar)}
          onClose={() => setPorConfirmar(null)}
          onConfirm={async () => {
            const { tipo, maquina } = porConfirmar;
            if (tipo === 'encender') await encenderMaquina(maquina);
            else if (tipo === 'eliminar') await eliminarMaquina(maquina);
            else await handleDesconectarSonoff();
            setPorConfirmar(null);
          }}
        />
      )}

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
                <Selector
                  claseCampo={INPUT_CLS}
                  valor={form.tipo}
                  onChange={v => handleCambioConModelo({ target: { name: 'tipo', value: v } })}
                  titulo="Tipo"
                  opciones={TIPOS.map(t => ({ valor: t.v, etiqueta: t.label }))}
                />
              </div>

              {/* La secadora también lleva tamaño (precio y tiempo propios). */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Tamaño <span className="text-red-500">*</span>
                </label>
                <Selector
                  claseCampo={INPUT_CLS}
                  valor={form.tamano}
                  onChange={v => handleCambioConModelo({ target: { name: 'tamano', value: v } })}
                  titulo="Tamaño"
                  opciones={TAMANOS.map(t => ({ valor: t.v, etiqueta: t.label }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Capacidad <span className="text-red-500">*</span>
                </label>
                <Selector
                  claseCampo={INPUT_CLS}
                  valor={form.capacidad}
                  onChange={v => handleChange({ target: { name: 'capacidad', value: v } })}
                  titulo="Capacidad"
                  opciones={CAPACIDADES.map(c => ({ valor: c.v, etiqueta: c.label }))}
                />
              </div>

              {/* Marca y modelo, de los catálogos de Ajustes → Máquinas. La marca es
                  obligatoria: sin ella no hay modelo ni tiempo de ciclo. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Marca <span className="text-red-500">*</span>
                </label>
                {/* La marca de esta máquina se ofrece aunque ya no esté en el catálogo. */}
                <Selector
                  claseCampo={INPUT_CLS}
                  requerido
                  valor={form.marca}
                  onChange={v => handleCambioConModelo({ target: { name: 'marca', value: v } })}
                  marcador="Elige una marca"
                  titulo="Marca"
                  opciones={[
                    ...(marcaFueraDeLista ? [{ valor: form.marca, etiqueta: form.marca }] : []),
                    ...marcasVisibles.map(m => ({ valor: m.nombre, etiqueta: m.nombre })),
                  ]}
                />
              </div>

              <div>
                {/* Obligatorio (el tiempo se configura por modelo), salvo si la marca aún
                    no tiene modelos de este tipo: un select apagado no se valida. */}
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Modelo <span className="text-red-500">*</span>
                </label>
                <Selector
                  claseCampo={INPUT_CLS}
                  requerido
                  deshabilitado={modeloBloqueado}
                  valor={form.modelo}
                  onChange={v => handleChange({ target: { name: 'modelo', value: v } })}
                  marcador="Elige un modelo"
                  titulo="Modelo"
                  opciones={[
                    ...(modeloFueraDeLista ? [{ valor: form.modelo, etiqueta: form.modelo }] : []),
                    ...modelosVisibles.map(mo => ({ valor: mo.nombre, etiqueta: mo.nombre })),
                  ]}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {!form.marca
                    ? 'Elige primero la marca.'
                    : modelosVisibles.length === 0
                      ? `${form.marca} no tiene modelos de este tipo y tamaño. Se agregan en Ajustes → Máquinas.`
                      : 'Los modelos se agregan en Ajustes → Máquinas.'}
                </p>
              </div>

              {/* Sonoff (eWeLink). Vacío = sin control remoto. */}
              {/* En un modelo de fichas solo se muestra si quedó uno enlazado, para quitarlo. */}
              {CON_SONOFF && (!modeloDeFichas || form.device_id.trim() !== '') && (<>
              <div>
                {modeloDeFichas && (
                  <p className="mb-1.5 text-xs font-medium text-amber-700">
                    Este modelo trabaja con fichas: la app no usará este Sonoff. Borra el ID para desenlazarlo.
                  </p>
                )}
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Sonoff — ID del dispositivo
                  <span className="ml-1 font-normal text-gray-400">(opcional)</span>
                </label>
                <input
                  name="device_id" value={form.device_id}
                  onChange={(e) => { setProbarMsg(null); handleChange(e); }}
                  placeholder="Device ID de eWeLink (ej. 10001abcd2)"
                  className={INPUT_CLS}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Se ve en la app eWeLink, en la información del dispositivo.
                </p>

                {editandoId != null && form.device_id.trim() !== '' && (
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button" onClick={() => handleProbar()} disabled={probando}
                        className="text-sm font-medium text-blue border border-blue/40 rounded-lg px-4 py-2 hover:bg-blue/5 disabled:opacity-60 transition-colors"
                      >
                        {probando ? 'Probando…' : 'Probar enlace'}
                      </button>
                      {/* Apagar siempre está disponible, también en uso. */}
                      {mostrarApagadoEmergencia && (
                        <button
                          type="button" onClick={handleApagarYa} disabled={apagando}
                          className="text-sm font-semibold text-white bg-red-600 rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-60 transition-colors"
                        >
                          {apagando ? 'Apagando…' : 'Apagar ahora'}
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">
                      "Probar enlace" solo consulta el dispositivo; no mueve la máquina.
                      {mostrarApagadoEmergencia && ' "Apagar ahora" corta el Sonoff de inmediato.'}
                    </p>
                    {probarMsg && (
                      <p className={`mt-1.5 text-sm font-medium ${
                        probarMsg.tipo === 'ok'  ? 'text-green-600'
                        : probarMsg.tipo === 'sim' ? 'text-amber-700'
                        : 'text-red-600'
                      }`}>
                        {probarMsg.tipo === 'ok' ? '✓ ' : probarMsg.tipo === 'sim' ? '⚠ ' : '✗ '}{probarMsg.texto}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {form.device_id.trim() !== '' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Sonoff — canal
                    <span className="ml-1 font-normal text-gray-400">(solo multi-relé)</span>
                  </label>
                  <input
                    name="device_canal" type="number" min="0" value={form.device_canal} onChange={handleChange}
                    placeholder="0"
                    className={INPUT_CLS}
                  />
                </div>
              )}
              </>)}

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
