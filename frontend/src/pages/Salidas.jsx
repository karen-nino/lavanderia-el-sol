import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

const BADGE_MAQUINA_ESTADO = {
  disponible:    { label: 'Disponible',    cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

export default function Salidas() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [nota,            setNota]            = useState(null);
  const [productos,        setProductos]        = useState([]);
  const [cantidades,       setCantidades]       = useState({});
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingMaquina,   setLoadingMaquina]   = useState(false);
  const [loadingProducto,  setLoadingProducto]  = useState(null); // id del producto en proceso
  const [errorAccion,      setErrorAccion]      = useState('');
  const [confirmDetener,   setConfirmDetener]   = useState(false);

  // Activar nota En Espera
  const [activarOpen,      setActivarOpen]      = useState(false);
  const [maquinasDisp,     setMaquinasDisp]     = useState([]);
  const [maquinaSel,       setMaquinaSel]       = useState('');
  const [secadoraSel,      setSecadoraSel]      = useState('');
  const [cargasSel,        setCargasSel]        = useState([]);
  const [loadingMaquinas,  setLoadingMaquinas]  = useState(false);

  // Agregar secadora a una nota ya en proceso
  const [agregarSecOpen,   setAgregarSecOpen]   = useState(false);
  const [secadorasDisp,    setSecadorasDisp]    = useState([]);
  const [secAgregarSel,    setSecAgregarSel]    = useState('');
  const [secAgregarCargas, setSecAgregarCargas] = useState('1');
  const [loadingSecadoras, setLoadingSecadoras] = useState(false);

  // Procesar carga (ciclo terminado)
  const [confirmProcesar,  setConfirmProcesar]  = useState(false);

  const cargarDatos = useCallback(async () => {
    try {
      const [notaData, productosData] = await Promise.all([
        api.get(`/notas/${id}`),
        api.get('/productos'),
      ]);
      setNota(notaData);
      setProductos(productosData);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    let activo = true;
    // El rule detecta que cargarDatos termina llamando setState; aquí es el
    // patrón normal "cargar al montar / al cambiar id" — no es un loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarDatos().finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [cargarDatos]);

  // Máquinas asignadas a la nota, sin repetir: las de sus cargas
  // (autoservicio) o las columnas legadas maquina_id / secadora_id.
  const cargasNota = nota?.cargas ?? [];
  const maquinasNota = [...new Set(
    cargasNota.length > 0
      ? cargasNota.flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean)
      : [nota?.maquina_id, nota?.secadora_id].filter(Boolean)
  )];

  // Activa las máquinas asignadas que siguen libres (cargas en espera). Sirve
  // tanto para una nota En Espera como para una En Proceso con cargas pendientes.
  async function activarPendientes() {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/activar-pendientes`);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  async function detenerCiclo() {
    if (maquinasNota.length === 0) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await Promise.all(
        maquinasNota.map(mid => api.patch(`/maquinas/${mid}/detener-ciclo`))
      );
      setConfirmDetener(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmDetener(false);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Activa la nota En Espera. Autoservicio: abre el selector por carga
  // (una lavadora y/o secadora para cada una). Encargo / legado: si ya
  // tiene máquina la usa directo; si no, abre el selector simple.
  async function iniciarActivar() {
    if (cargasNota.length === 0 && maquinasNota.length > 0) {
      await activarNota(nota.maquina_id, nota.secadora_id);
      return;
    }
    setErrorAccion('');
    setMaquinaSel('');
    setSecadoraSel('');
    setCargasSel(cargasNota.map(c => ({
      lavadora_id: c.lavadora_id ? String(c.lavadora_id) : '',
      secadora_id: c.secadora_id ? String(c.secadora_id) : '',
    })));
    setActivarOpen(true);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      setMaquinasDisp((data ?? []).filter(m => m.estado === 'disponible'));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquinas(false);
    }
  }

  async function activarNota(maquinaId, secadoraId) {
    if (!maquinaId && !secadoraId) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/activar`, {
        maquina_id:  maquinaId  ? Number(maquinaId)  : null,
        secadora_id: secadoraId ? Number(secadoraId) : null,
      });
      setActivarOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Activación de autoservicio: envía las máquinas elegidas por carga.
  async function activarNotaCargas() {
    if (!cargasSel.some(c => c.lavadora_id || c.secadora_id)) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/activar`, {
        cargas: cargasSel.map(c => ({
          lavadora_id: c.lavadora_id ? Number(c.lavadora_id) : null,
          secadora_id: c.secadora_id ? Number(c.secadora_id) : null,
        })),
      });
      setActivarOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Procesar carga terminada: la nota pasa a "Por Entregar" (LISTA). El
  // backend libera todas sus máquinas al hacer la transición.
  async function procesarNota() {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/estado`, { estado: 'LISTA' });
      setConfirmProcesar(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmProcesar(false);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el selector de secadoras disponibles para agregarla a una nota
  // que ya está en proceso (lavadora en uso).
  async function iniciarAgregarSecadora() {
    setErrorAccion('');
    setSecAgregarSel('');
    setSecAgregarCargas('1');
    setAgregarSecOpen(true);
    setLoadingSecadoras(true);
    try {
      const data = await api.get('/maquinas');
      setSecadorasDisp((data ?? []).filter(m => m.tipo === 'secadora' && m.estado === 'disponible'));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingSecadoras(false);
    }
  }

  async function confirmarAgregarSecadora() {
    if (!secAgregarSel) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-secadora`, {
        secadora_id: Number(secAgregarSel),
        cantidad_cargas_secadora: Number(secAgregarCargas) || 1,
      });
      setAgregarSecOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  async function agregarProducto(productoId) {
    const cantidad = Number(cantidades[productoId]);
    if (!cantidad || cantidad <= 0) return;
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.post(`/notas/${id}/productos`, { producto_id: productoId, cantidad });
      setCantidades(prev => ({ ...prev, [productoId]: '' }));
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingProducto(null);
    }
  }

  async function eliminarProducto(productoId) {
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}/productos/${productoId}`);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingProducto(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>
      </div>
    );
  }

  // Lista de máquinas asignadas (sin repetir) para mostrarlas con su badge:
  // de las cargas si las hay, o de las columnas legadas.
  const maquinasAsignadas = (() => {
    if (cargasNota.length === 0) {
      return [
        nota?.maquina_id  && { id: nota.maquina_id,  nombre: nota.maquina_nombre,  tipo: nota.maquina_tipo,  estado: nota.maquina_estado  },
        nota?.secadora_id && { id: nota.secadora_id, nombre: nota.secadora_nombre, tipo: nota.secadora_tipo, estado: nota.secadora_estado },
      ].filter(Boolean);
    }
    const porId = new Map();
    for (const c of cargasNota) {
      if (c.lavadora_id) porId.set(c.lavadora_id, { id: c.lavadora_id, nombre: c.lavadora_nombre, tipo: c.lavadora_tipo, estado: c.lavadora_estado });
      if (c.secadora_id) porId.set(c.secadora_id, { id: c.secadora_id, nombre: c.secadora_nombre, tipo: c.secadora_tipo, estado: c.secadora_estado });
    }
    return [...porId.values()];
  })();

  const maquinaEnUso = maquinasAsignadas.some(m => m.estado === 'en_uso');
  // Máquinas ya asignadas a la nota que siguen libres (cargas en espera).
  const maquinasPendientes = maquinasAsignadas.filter(m => m.estado === 'disponible');

  // ¿El ciclo ya terminó? (mismo cálculo que el dashboard)
  // El servidor promueve la nota a POR_PROCESAR al cumplirse el tiempo de
  // lavado; aquí solo lo reflejamos para mostrar el botón "Procesar".
  const cicloTerminado = maquinaEnUso && nota?.estado === 'POR_PROCESAR';

  const nombresMaquinas = maquinasAsignadas.map(m => m.nombre).join(' y ');

  const productosNota  = nota?.productos || [];
  const productosIdsEnNota = new Set(productosNota.map(p => p.producto_id));

  // Solo productos disponibles (stock_disponible > 0) que no estén ya en la nota
  const productosDisponibles = productos.filter(
    p => Number(p.stock_disponible) > 0 && !productosIdsEnNota.has(p.id)
  );

  return (
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/notas/${id}`)}
          aria-label="Volver"
          className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">Salidas</h1>
          <p className="text-xs text-gray-500">{nota?.folio ?? `Nota #${id}`}</p>
        </div>
      </div>

      {errorAccion && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorAccion}
        </div>
      )}

      {/* Sección 1 — Máquinas */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">
            {maquinasAsignadas.length > 1 ? 'Máquinas asignadas' : 'Máquina asignada'}
          </h2>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            {maquinasAsignadas.length > 0 ? (
              <div className="space-y-2">
                {maquinasAsignadas.map((m, i) => {
                  const cfg = BADGE_MAQUINA_ESTADO[m.estado];
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                      {MAQUINA_TIPO_LABEL[m.tipo] && (
                        <span className="text-xs text-gray-500">— {MAQUINA_TIPO_LABEL[m.tipo]}</span>
                      )}
                      {cfg && (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                          {cfg.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
            )}
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {/* Activar las cargas que siguen en espera (máquinas asignadas y libres) */}
            {maquinasPendientes.length > 0 && (
              <button
                onClick={activarPendientes}
                disabled={loadingMaquina}
                className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar'}
              </button>
            )}
            {/* En Espera sin máquinas asignadas: abrir selector para elegirlas */}
            {maquinasPendientes.length === 0 && nota?.estado === 'EN_ESPERA' && (
              <button
                onClick={iniciarActivar}
                disabled={loadingMaquina}
                className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar'}
              </button>
            )}
            {/* Máquinas en uso: procesar (ciclo terminado) o detener */}
            {maquinaEnUso && (
              cicloTerminado ? (
                <button
                  onClick={() => setConfirmProcesar(true)}
                  disabled={loadingMaquina}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Procesar
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDetener(true)}
                  disabled={loadingMaquina}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Detener Ciclo
                </button>
              )
            )}
          </div>
        </div>
        {['EN_PROCESO', 'POR_PROCESAR'].includes(nota?.estado) && cargasNota.some(c => !c.secadora_id) && (
          <div className="px-4 pb-4">
            <button
              onClick={iniciarAgregarSecadora}
              disabled={loadingMaquina}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-gray-300 rounded-lg text-sm font-medium text-blue hover:border-blue-400 hover:bg-light-blue/40 disabled:opacity-60 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Agregar secadora
            </button>
          </div>
        )}
      </div>

      {/* Sección 2 — Productos en la nota */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Productos en esta nota</h2>
          <button
            onClick={cargarDatos}
            className="text-xs text-blue hover:underline"
          >
            Actualizar
          </button>
        </div>
        {productosNota.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">Sin productos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {productosNota.map(p => (
              <div key={p.producto_id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Cant. {p.cantidad} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}
                  </p>
                </div>
                <button
                  onClick={() => eliminarProducto(p.producto_id)}
                  disabled={loadingProducto === p.producto_id}
                  className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                  title="Eliminar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
            <div className="px-4 py-3 bg-gray-50 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(nota?.precio_total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Sección 3 — Agregar productos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Agregar productos</h2>
          <p className="text-xs text-gray-400 mt-0.5">Solo productos con stock disponible</p>
        </div>
        {productosDisponibles.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">
            {productos.length === 0
              ? 'No hay productos registrados'
              : 'Sin stock disponible o todos ya están en la nota'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {productosDisponibles.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Disponible: {p.stock_disponible} {p.unidad} · {fmtMonto(p.precio_unitario)}
                  </p>
                </div>
                <input
                  type="number"
                  min="1"
                  max={p.stock_disponible}
                  value={cantidades[p.id] ?? ''}
                  onChange={e => setCantidades(prev => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="Cant."
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue"
                />
                <button
                  onClick={() => agregarProducto(p.id)}
                  disabled={!cantidades[p.id] || loadingProducto === p.id}
                  className="px-3 py-1.5 bg-blue hover:opacity-90 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                >
                  {loadingProducto === p.id ? '...' : 'Agregar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal confirmar detener ciclo */}
      {confirmDetener && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Detener ciclo</h3>
            <p className="text-sm text-gray-500">
              ¿Detener el ciclo de <span className="font-semibold text-gray-800">{nombresMaquinas}</span>? {maquinasAsignadas.length > 1 ? 'Las máquinas pasarán' : 'La máquina pasará'} a disponible y se reiniciará su temporizador.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDetener(false)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={detenerCiclo}
                disabled={loadingMaquina}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Deteniendo...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar procesar carga */}
      {confirmProcesar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Procesar carga</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{nombresMaquinas}</span> ya terminó? {maquinasAsignadas.length > 1 ? 'Las máquinas pasarán' : 'La máquina pasará'} a disponible y la nota a <span className="font-semibold text-gray-800">"Por Entregar"</span>.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmProcesar(false)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={procesarNota}
                disabled={loadingMaquina}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal activar nota — selección de máquina */}
      {activarOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">Activar nota</h3>
              <p className="text-sm text-gray-500 mt-1">
                {cargasSel.length > 0
                  ? 'Asigna las máquinas de cada carga. La nota pasará a '
                  : 'Selecciona lavadora y/o secadora. La nota pasará a '}
                <span className="font-medium text-gray-700">En Proceso</span> y las máquinas quedarán en uso.
              </p>
            </div>

            {loadingMaquinas ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : maquinasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay máquinas disponibles.</p>
            ) : cargasSel.length > 0 ? (
              /* Autoservicio: una lavadora y/o secadora por carga */
              <div className="space-y-3">
                {cargasSel.map((c, i) => (
                  <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-900">Carga {i + 1}</p>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Lavadora</label>
                      <select
                        value={c.lavadora_id}
                        onChange={e => setCargasSel(prev => prev.map((x, idx) =>
                          idx === i ? { ...x, lavadora_id: e.target.value } : x))}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue"
                      >
                        <option value="">Sin asignar</option>
                        {maquinasDisp.filter(m => m.tipo !== 'secadora').map(m => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}{MAQUINA_TIPO_LABEL[m.tipo] ? ` — ${MAQUINA_TIPO_LABEL[m.tipo]}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Secadora</label>
                      <select
                        value={c.secadora_id}
                        onChange={e => setCargasSel(prev => prev.map((x, idx) =>
                          idx === i ? { ...x, secadora_id: e.target.value } : x))}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue"
                      >
                        <option value="">Sin asignar</option>
                        {maquinasDisp.filter(m => m.tipo === 'secadora').map(m => (
                          <option key={m.id} value={m.id}>{m.nombre}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Lavadora */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lavadora</p>
                  {maquinasDisp.filter(m => m.tipo !== 'secadora').length === 0 ? (
                    <p className="text-sm text-gray-400">No hay lavadoras disponibles.</p>
                  ) : (
                    maquinasDisp.filter(m => m.tipo !== 'secadora').map(m => {
                      const selected = String(maquinaSel) === String(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMaquinaSel(selected ? '' : String(m.id))}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="font-medium text-gray-800">{m.nombre}</span>
                          {MAQUINA_TIPO_LABEL[m.tipo] && (
                            <span className="text-xs text-gray-500">{MAQUINA_TIPO_LABEL[m.tipo]}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Secadora */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Secadora <span className="font-normal normal-case">(opcional)</span></p>
                  {maquinasDisp.filter(m => m.tipo === 'secadora').length === 0 ? (
                    <p className="text-sm text-gray-400">No hay secadoras disponibles.</p>
                  ) : (
                    maquinasDisp.filter(m => m.tipo === 'secadora').map(m => {
                      const selected = String(secadoraSel) === String(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSecadoraSel(selected ? '' : String(m.id))}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="font-medium text-gray-800">{m.nombre}</span>
                          {MAQUINA_TIPO_LABEL[m.tipo] && (
                            <span className="text-xs text-gray-500">{MAQUINA_TIPO_LABEL[m.tipo]}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setActivarOpen(false)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => cargasSel.length > 0 ? activarNotaCargas() : activarNota(maquinaSel, secadoraSel)}
                disabled={loadingMaquina || (cargasSel.length > 0
                  ? !cargasSel.some(c => c.lavadora_id || c.secadora_id)
                  : (!maquinaSel && !secadoraSel))}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal agregar secadora — nota ya en proceso */}
      {agregarSecOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">Agregar secadora</h3>
              <p className="text-sm text-gray-500 mt-1">
                Selecciona una secadora. Quedará en uso y su tarifa se sumará al total de la nota.
              </p>
            </div>

            {loadingSecadoras ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : secadorasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay secadoras disponibles.</p>
            ) : (
              <div className="space-y-2">
                {secadorasDisp.map(m => {
                  const selected = String(secAgregarSel) === String(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSecAgregarSel(selected ? '' : String(m.id))}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                        selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span className="font-medium text-gray-800">{m.nombre}</span>
                      {MAQUINA_TIPO_LABEL[m.tipo] && (
                        <span className="text-xs text-gray-500">{MAQUINA_TIPO_LABEL[m.tipo]}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {secAgregarSel && (
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Cantidad de cargas <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="1" step="1"
                    value={secAgregarCargas}
                    onChange={e => setSecAgregarCargas(e.target.value)}
                    placeholder="1"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base text-center focus:outline-none focus:ring-2 focus:ring-blue [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSecAgregarCargas(c => String(Math.max(1, (Number(c) || 1) - 1)))}
                    disabled={(Number(secAgregarCargas) || 1) <= 1}
                    aria-label="Disminuir cargas"
                    className="flex-shrink-0 w-12 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setSecAgregarCargas(c => String((Number(c) || 0) + 1))}
                    aria-label="Aumentar cargas"
                    className="flex-shrink-0 w-12 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setAgregarSecOpen(false)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAgregarSecadora}
                disabled={loadingMaquina || !secAgregarSel}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
