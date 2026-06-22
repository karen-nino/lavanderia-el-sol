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
  const [loadingMaquinas,  setLoadingMaquinas]  = useState(false);

  // Procesar carga (ciclo terminado)
  const [tiempos,          setTiempos]          = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [now,              setNow]              = useState(() => Date.now());
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

  // Tiempos de carga (no cambian en tiempo real, se piden una vez).
  useEffect(() => {
    let activo = true;
    api.get('/ajustes').then(a => {
      if (!activo || !a) return;
      setTiempos({
        mediana:  a.tiempo_carga_mediana  != null ? Number(a.tiempo_carga_mediana)  : 30,
        jumbo:    a.tiempo_carga_jumbo    != null ? Number(a.tiempo_carga_jumbo)    : 45,
        secadora: a.tiempo_carga_secadora != null ? Number(a.tiempo_carga_secadora) : 30,
      });
    }).catch(() => {});
    return () => { activo = false; };
  }, []);

  // Reloj para detectar cuándo el ciclo de la máquina ya terminó.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function activarMaquina() {
    if (!nota?.maquina_id) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/maquinas/${nota.maquina_id}/estado`, { estado: 'en_uso' });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  async function detenerCiclo() {
    if (!nota?.maquina_id) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/maquinas/${nota.maquina_id}/estado`, { estado: 'disponible' });
      setConfirmDetener(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmDetener(false);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Activa la nota En Espera: si ya tiene máquina la usa directo; si no, abre
  // el selector para elegir una.
  async function iniciarActivar() {
    if (nota?.maquina_id) {
      await activarNota(nota.maquina_id);
      return;
    }
    setErrorAccion('');
    setMaquinaSel('');
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

  async function activarNota(maquinaId) {
    if (!maquinaId) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/activar`, { maquina_id: Number(maquinaId) });
      setActivarOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Procesar carga terminada: la nota pasa a "Por Entregar" (LISTA) y la
  // máquina a disponible. Igual que la acción "Procesar" del dashboard.
  async function procesarNota() {
    if (!nota?.maquina_id) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      if (nota.estado === 'EN_PROCESO') {
        await api.patch(`/notas/${id}/estado`, { estado: 'LISTA' });
      }
      await api.patch(`/maquinas/${nota.maquina_id}/estado`, { estado: 'disponible' });
      setConfirmProcesar(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmProcesar(false);
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

  const maquina         = nota?.maquina_nombre;
  const maquinaEnUso    = nota?.maquina_estado === 'en_uso';

  // ¿El ciclo de la máquina ya terminó? (mismo cálculo que el dashboard)
  const minutosCiclo  = nota?.maquina_tipo === 'secadora'       ? tiempos.secadora
                      : nota?.maquina_tipo === 'lavadora_jumbo' ? tiempos.jumbo
                      : tiempos.mediana;
  const duracionSeg   = Math.max(0, Number(minutosCiclo) || 0) * 60;
  const inicioCiclo   = nota?.maquina_en_uso_desde ? new Date(nota.maquina_en_uso_desde).getTime() : null;
  const cicloTerminado = maquinaEnUso && inicioCiclo != null
    && Math.floor((now - inicioCiclo) / 1000) >= duracionSeg;

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
          className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition-colors"
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

      {/* Sección 1 — Máquina */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Máquina asignada</h2>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            {maquina ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{maquina}</span>
                {MAQUINA_TIPO_LABEL[nota.maquina_tipo] && (
                  <span className="text-xs text-gray-500">— {MAQUINA_TIPO_LABEL[nota.maquina_tipo]}</span>
                )}
                {(() => {
                  const cfg = BADGE_MAQUINA_ESTADO[nota.maquina_estado];
                  if (!cfg) return null;
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${nota.maquina_estado === 'en_uso' ? 'animate-pulse' : ''}`} />
                      {cfg.label}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
            )}
          </div>
          {nota?.estado === 'EN_ESPERA' ? (
            <button
              onClick={iniciarActivar}
              disabled={loadingMaquina}
              className="flex-shrink-0 px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loadingMaquina ? 'Activando...' : 'Activar'}
            </button>
          ) : nota?.maquina_id ? (
            maquinaEnUso ? (
              cicloTerminado ? (
                <button
                  onClick={() => setConfirmProcesar(true)}
                  disabled={loadingMaquina}
                  className="flex-shrink-0 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Procesar
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDetener(true)}
                  disabled={loadingMaquina}
                  className="flex-shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Detener Ciclo
                </button>
              )
            ) : (
              <button
                onClick={activarMaquina}
                disabled={loadingMaquina}
                className="flex-shrink-0 px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar máquina'}
              </button>
            )
          ) : null}
        </div>
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
              ¿Detener el ciclo de <span className="font-semibold text-gray-800">{nota.maquina_nombre}</span>? La máquina pasará a disponible y se reiniciará su temporizador.
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
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{nota.maquina_nombre}</span> ya terminó? La máquina pasará a disponible y la nota a <span className="font-semibold text-gray-800">"Por Entregar"</span>.
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
                Selecciona la máquina. La nota pasará a <span className="font-medium text-gray-700">En Proceso</span> y la máquina quedará en uso.
              </p>
            </div>

            {loadingMaquinas ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : maquinasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay máquinas disponibles.</p>
            ) : (
              <div className="space-y-2">
                {maquinasDisp.map(m => {
                  const selected = String(maquinaSel) === String(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMaquinaSel(String(m.id))}
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
                onClick={() => activarNota(maquinaSel)}
                disabled={loadingMaquina || !maquinaSel}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
