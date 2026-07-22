import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

const BADGE_MAQUINA_ESTADO = {
  // "disponible" aquí = máquina asignada a la carga pero sin iniciar (En espera): gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
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
  const [confirmDetener,   setConfirmDetener]   = useState(null); // máquina a detener

  // Activar nota En Espera
  const [activarOpen,      setActivarOpen]      = useState(false);
  const [maquinasDisp,     setMaquinasDisp]     = useState([]);
  const [maquinaSel,       setMaquinaSel]       = useState('');
  const [secadoraSel,      setSecadoraSel]      = useState('');
  const [cargasSel,        setCargasSel]        = useState([]);
  const [loadingMaquinas,  setLoadingMaquinas]  = useState(false);

  // Asignar una máquina extra (lavadora o secadora): crea una carga nueva,
  // por cobrar o sin cobro según elija el empleado.
  const [asignarOpen,      setAsignarOpen]      = useState(false);
  const [asignarMaqSel,    setAsignarMaqSel]    = useState('');
  const [asignarCobrar,    setAsignarCobrar]    = useState(null); // true | false | null

  // Terminar el lavado de UNA lavadora: elegir la secadora de su carga
  const [lavTerminando,    setLavTerminando]    = useState(null); // máquina lavadora
  const [secadorasDisp,    setSecadorasDisp]    = useState([]);
  const [secTerminarSel,   setSecTerminarSel]   = useState('');
  const [loadingSecadoras, setLoadingSecadoras] = useState(false);

  // Terminar el secado de UNA secadora (si es la última, la nota pasa a Por Entregar)
  const [confirmTerminarSec, setConfirmTerminarSec] = useState(null); // máquina secadora

  // Tiempos de ciclo por tipo de máquina (Ajustes) y reloj para calcular,
  // por máquina, si su ciclo ya se cumplió (igual que el dashboard).
  const [tiempos, setTiempos] = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [now, setNow] = useState(() => Date.now());

  const cargarDatos = useCallback(async () => {
    try {
      const [notaData, productosData, ajustes] = await Promise.all([
        api.get(`/notas/${id}`),
        api.get('/productos'),
        api.get('/ajustes').catch(() => null),
      ]);
      setNota(notaData);
      setProductos(productosData);
      if (ajustes) {
        setTiempos({
          mediana:  ajustes.tiempo_carga_mediana  != null ? Number(ajustes.tiempo_carga_mediana)  : 30,
          jumbo:    ajustes.tiempo_carga_jumbo    != null ? Number(ajustes.tiempo_carga_jumbo)    : 45,
          secadora: ajustes.tiempo_carga_secadora != null ? Number(ajustes.tiempo_carga_secadora) : 30,
        });
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

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

  // Arranca UNA máquina asignada y libre (botón "Iniciar Lavado"/"Iniciar
  // Secado" por máquina): la pone en uso y la nota pasa a la fase que
  // corresponda. Las demás máquinas asignadas siguen en espera.
  async function iniciarMaquina(maquinaId) {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/activar-pendientes`, { maquina_id: maquinaId });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Detiene el ciclo de UNA máquina (lavadora o secadora): pasa a disponible
  // y reinicia su temporizador. Las demás máquinas de la nota no se tocan.
  async function detenerCiclo() {
    if (!confirmDetener) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/maquinas/${confirmDetener.id}/detener-ciclo`);
      setConfirmDetener(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmDetener(null);
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

  // Abre el selector para asignar una máquina extra (lavadora o secadora).
  async function iniciarAsignar() {
    setErrorAccion('');
    setAsignarMaqSel('');
    setAsignarCobrar(null);
    setAsignarOpen(true);
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

  // Asigna la máquina elegida: el backend crea la carga nueva (por cobrar o
  // sin cobro) y la máquina arranca de inmediato.
  async function confirmarAsignar() {
    if (!asignarMaqSel || asignarCobrar === null) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-maquina`, {
        maquina_id: Number(asignarMaqSel),
        cobrar: asignarCobrar,
      });
      setAsignarOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Terminar el secado de una secadora: el backend la libera y, si era la
  // última máquina de la nota, la pasa a "Por Entregar".
  async function terminarSecado() {
    if (!confirmTerminarSec) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/terminar-secado`, { secadora_id: Number(confirmTerminarSec.id) });
      setConfirmTerminarSec(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmTerminarSec(null);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el selector de secadoras disponibles para terminar el lavado de
  // ESA lavadora: se libera y su carga continúa en la secadora elegida.
  async function iniciarTerminarLavado(lavadora) {
    setErrorAccion('');
    setSecTerminarSel('');
    setLavTerminando(lavadora);
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

  async function confirmarTerminarLavado() {
    if (!lavTerminando || !secTerminarSel) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/terminar-lavado`, {
        lavadora_id: Number(lavTerminando.id),
        secadora_id: Number(secTerminarSel),
      });
      setLavTerminando(null);
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

  // Máquinas agrupadas por carga (cada carga con su lavadora y/o secadora), para
  // mostrarlas bajo su encabezado "Carga N". Si la nota es legada (sin cargas),
  // se agrupa como una sola carga con las columnas legadas.
  const cargasMaquinas = (() => {
    if (cargasNota.length === 0) {
      const ms = [
        nota?.maquina_id  && { id: nota.maquina_id,  nombre: nota.maquina_nombre,  tipo: nota.maquina_tipo,  estado: nota.maquina_estado,  en_uso_desde: nota.maquina_en_uso_desde  },
        nota?.secadora_id && { id: nota.secadora_id, nombre: nota.secadora_nombre, tipo: nota.secadora_tipo, estado: nota.secadora_estado, en_uso_desde: nota.secadora_en_uso_desde },
      ].filter(Boolean);
      return ms.length > 0 ? [{ orden: null, maquinas: ms }] : [];
    }
    return cargasNota
      .map(c => ({
        orden: c.orden,
        maquinas: [
          c.lavadora_id && { id: c.lavadora_id, nombre: c.lavadora_nombre, tipo: c.lavadora_tipo, estado: c.lavadora_estado, en_uso_desde: c.lavadora_en_uso_desde },
          c.secadora_id && { id: c.secadora_id, nombre: c.secadora_nombre, tipo: c.secadora_tipo, estado: c.secadora_estado, en_uso_desde: c.secadora_en_uso_desde },
        ].filter(Boolean),
      }))
      .filter(g => g.maquinas.length > 0);
  })();

  // Lista plana (para conteo del encabezado y validaciones de acciones a nivel nota).
  const maquinasAsignadas = cargasMaquinas.flatMap(g => g.maquinas);

  // ¿Esta máquina ya cumplió su tiempo de ciclo? Cada máquina es
  // independiente (mismo cálculo que las tarjetas del dashboard): la
  // lavadora terminada ofrece "Iniciar Secado" y la secadora terminada
  // "Terminar Ciclo", aunque otras cargas de la nota sigan corriendo.
  const cicloCumplido = (m) => {
    if (m.estado !== 'en_uso' || !m.en_uso_desde) return false;
    if (!['LAVANDO', 'SECANDO'].includes(nota?.estado)) return false;
    // Ciclo sellado al arrancar (ciclo_minutos); fallback por tipo para
    // máquinas en uso desde antes de la migración.
    const minutos = m.ciclo_minutos != null ? m.ciclo_minutos
                  : m.tipo === 'secadora'       ? tiempos.secadora
                  : m.tipo === 'lavadora_jumbo' ? tiempos.jumbo
                  : tiempos.mediana;
    return now - new Date(m.en_uso_desde).getTime() >= Math.max(0, Number(minutos) || 0) * 60000;
  };
  // ¿Otras máquinas de la nota siguen en uso además de esta?
  const otrasEnUso = (maq) => maquinasAsignadas.some(m => String(m.id) !== String(maq.id) && m.estado === 'en_uso');

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
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">
            {maquinasAsignadas.length > 1 ? 'Máquinas asignadas' : 'Máquina asignada'}
          </h2>
          {/* Asignar una máquina extra: disponible salvo en notas cerradas */}
          {nota && !['FINALIZADA', 'CANCELADA'].includes(nota.estado) && (
            <button
              onClick={iniciarAsignar}
              disabled={loadingMaquina}
              className="flex items-center gap-1 text-xs font-medium text-blue hover:underline disabled:opacity-60"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Asignar Máquina
            </button>
          )}
        </div>
        <div className="px-4 py-4 space-y-4">
          {cargasMaquinas.length > 0 ? (
            cargasMaquinas.map((grupo, gi) => (
              <div key={gi} className="space-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-gray-100 [&:not(:first-child)]:pt-4">
                {grupo.orden != null && (
                  <p className="text-xs font-semibold text-gray-500">Carga {grupo.orden}</p>
                )}
                {grupo.maquinas.map((m, i) => {
                  const cfg = BADGE_MAQUINA_ESTADO[m.estado];
                  return (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        {/* Estado: solo el punto de color */}
                        {cfg && (
                          <span
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' ? 'animate-pulse' : ''}`}
                            title={cfg.label}
                          />
                        )}
                        <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                        {MAQUINA_TIPO_LABEL[m.tipo] && (
                          <span className="text-xs text-gray-500">— {MAQUINA_TIPO_LABEL[m.tipo]}</span>
                        )}
                      </div>
                      {/* Acción por máquina: cada carga es independiente */}
                      {m.estado === 'disponible' && (
                        <button
                          onClick={() => iniciarMaquina(m.id)}
                          disabled={loadingMaquina}
                          className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {loadingMaquina ? 'Iniciando...' : (m.tipo === 'secadora' ? 'Iniciar Secado' : 'Iniciar Lavado')}
                        </button>
                      )}
                      {m.estado === 'en_uso' && (
                        cicloCumplido(m) ? (
                          m.tipo === 'secadora' ? (
                            <button
                              onClick={() => setConfirmTerminarSec(m)}
                              disabled={loadingMaquina}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Finalizar Carga
                            </button>
                          ) : (
                            <button
                              onClick={() => iniciarTerminarLavado(m)}
                              disabled={loadingMaquina}
                              className="px-4 py-2 bg-red hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Iniciar Secado
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() => setConfirmDetener(m)}
                            disabled={loadingMaquina}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            {m.tipo === 'secadora' ? 'Detener Secado' : 'Detener Lavado'}
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
          )}

          {/* En Espera sin ninguna máquina asignada: abrir selector para
              elegirlas. Con máquinas asignadas, cada una se arranca con su
              propio botón "Iniciar Lavado" de arriba. */}
          {maquinasAsignadas.length === 0 && nota?.estado === 'EN_ESPERA' && (
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={iniciarActivar}
                disabled={loadingMaquina}
                className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar'}
              </button>
            </div>
          )}
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
              ¿Detener el ciclo de <span className="font-semibold text-gray-800">{confirmDetener.nombre}</span>? La máquina pasará a disponible y se reiniciará su temporizador.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDetener(null)}
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

      {/* Modal confirmar terminar ciclo de una secadora */}
      {confirmTerminarSec && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Terminar ciclo</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmTerminarSec.nombre}</span> ya terminó? La secadora pasará a disponible.
            </p>
            {otrasEnUso(confirmTerminarSec) ? (
              <p className="text-sm text-gray-500">
                Las demás cargas de la nota siguen en proceso; la nota aún no pasa a "Por Entregar".
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                La nota pasará a estado <span className="font-semibold text-gray-800">"Por Entregar"</span>.
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmTerminarSec(null)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={terminarSecado}
                disabled={loadingMaquina}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Terminando...' : 'Confirmar'}
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
                <span className="font-medium text-gray-700">Lavando</span> (o{' '}
                <span className="font-medium text-gray-700">Secando</span> si solo lleva secadora) y las máquinas quedarán en uso.
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

      {/* Modal asignar máquina extra — cobro (por cobrar / sin cobro) + máquina */}
      {asignarOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">Asignar máquina</h3>
              <p className="text-sm text-gray-500 mt-1">
                Se agrega una <span className="font-medium text-gray-700">carga nueva</span> a la nota y la máquina arranca de inmediato.
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* Cobro de la carga nueva */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cobro</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAsignarCobrar(true)}
                  className={`flex flex-col items-start gap-0.5 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                    asignarCobrar === true ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-800">Por cobrar</span>
                  <span className="text-xs text-gray-500">Suma la tarifa al total</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAsignarCobrar(false)}
                  className={`flex flex-col items-start gap-0.5 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                    asignarCobrar === false ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-800">Sin cobro</span>
                  <span className="text-xs text-gray-500">La carga va en $0</span>
                </button>
              </div>
            </div>

            {/* Máquina (lavadora o secadora) */}
            {loadingMaquinas ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : maquinasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay máquinas disponibles.</p>
            ) : (
              <div className="space-y-4">
                {/* Lavadoras */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lavadoras</p>
                  {maquinasDisp.filter(m => m.tipo !== 'secadora').length === 0 ? (
                    <p className="text-sm text-gray-400">No hay lavadoras disponibles.</p>
                  ) : (
                    maquinasDisp.filter(m => m.tipo !== 'secadora').map(m => {
                      const selected = String(asignarMaqSel) === String(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setAsignarMaqSel(selected ? '' : String(m.id))}
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

                {/* Secadoras */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Secadoras</p>
                  {maquinasDisp.filter(m => m.tipo === 'secadora').length === 0 ? (
                    <p className="text-sm text-gray-400">No hay secadoras disponibles.</p>
                  ) : (
                    maquinasDisp.filter(m => m.tipo === 'secadora').map(m => {
                      const selected = String(asignarMaqSel) === String(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setAsignarMaqSel(selected ? '' : String(m.id))}
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
                onClick={() => setAsignarOpen(false)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAsignar}
                disabled={loadingMaquina || !asignarMaqSel || asignarCobrar === null}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Asignando...' : 'Asignar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal iniciar secado — elegir la secadora de la lavadora terminada */}
      {lavTerminando && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">Iniciar secado</h3>
              <p className="text-sm text-gray-500 mt-1">
                El lavado en <span className="font-semibold text-gray-800">{lavTerminando.nombre}</span> terminó y
                la lavadora pasará a disponible. Elige la secadora donde continúa su carga; si era
                la última lavadora, la nota pasará a <span className="font-medium text-gray-700">Secando</span>.
              </p>
            </div>

            {loadingSecadoras ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : secadorasDisp.length === 0 ? (
              <p className="text-sm text-red-600 text-center py-6">
                No hay secadoras disponibles. Libera una secadora para poder iniciar el secado.
              </p>
            ) : (
              <div className="space-y-2">
                {secadorasDisp.map(m => {
                  const selected = String(secTerminarSel) === String(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSecTerminarSel(selected ? '' : String(m.id))}
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
                onClick={() => setLavTerminando(null)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarTerminarLavado}
                disabled={loadingMaquina || !secTerminarSel}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Iniciando...' : 'Iniciar secado'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
