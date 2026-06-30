import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import MachineCard from './MachineCard';

// Cada cuánto se re-consultan notas y máquinas en segundo plano.
const REFRESCO_MS = 15000;

// Acción que el operador intentó pero no se completó porque la sesión expiró
// (la app redirige a /login). Se persiste para reabrir la confirmación al
// volver a entrar. Ver confirmarProcesar y la reanudación en la carga inicial.
const ACCION_PENDIENTE_KEY = 'accionPendiente';

function guardarAccionPendiente(accion) {
  try { localStorage.setItem(ACCION_PENDIENTE_KEY, JSON.stringify(accion)); } catch { /* ignore */ }
}
function leerAccionPendiente() {
  try {
    const raw = localStorage.getItem(ACCION_PENDIENTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function limpiarAccionPendiente() {
  try { localStorage.removeItem(ACCION_PENDIENTE_KEY); } catch { /* ignore */ }
}

function formatMMSS(totalSegundos) {
  const s = Math.max(0, Math.floor(totalSegundos));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Monitor de máquinas en uso: tarjetas con temporizador y la confirmación
// "Procesar carga". Es autónomo (consulta sus propios datos y se auto-refresca)
// para poder usarse tanto en la página Máquinas como en el Dashboard.
//
// `showHeader`: muestra el encabezado propio ("Máquinas en uso (n)" + botón de
// recargar), usado en el Dashboard. La página Máquinas lo oculta y lleva el
// título/conteo al nav (vía `onCountChange`) y el refresco a su botón (vía el
// método `refrescar` expuesto por ref).
const MaquinasEnUso = forwardRef(function MaquinasEnUso({ showHeader = true, onCountChange }, ref) {
  const navigate = useNavigate();
  const [notas, setNotas]       = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [tiempos, setTiempos]   = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());
  const [confirmProcesar, setConfirmProcesar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [errorProcesar, setErrorProcesar] = useState('');
  const [refrescando, setRefrescando] = useState(false);

  // Refresco silencioso de los datos que cambian en tiempo real. No toca
  // `loading` ni muestra errores: los fallos transitorios se ignoran y se
  // reintenta en el siguiente ciclo. Solo escribe si llegó un arreglo, para
  // no romper el render si la sesión expiró (api redirige y devuelve undefined).
  const refrescarDatos = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([
        api.get('/notas'),
        api.get('/maquinas'),
      ]);
      if (Array.isArray(n)) setNotas(n);
      if (Array.isArray(m)) setMaquinas(m);
    } catch {
      // ignorar: se reintenta en el siguiente ciclo de refresco
    }
  }, []);

  // Recarga manual (botón): muestra el giro mientras consulta.
  const refrescarManual = async () => {
    setRefrescando(true);
    try {
      await refrescarDatos();
    } finally {
      setRefrescando(false);
    }
  };

  // Permite que un contenedor (p. ej. el nav de la página Máquinas) dispare el
  // refresco. Devuelve la promesa para que pueda manejar su propio spinner.
  useImperativeHandle(ref, () => ({ refrescar: refrescarDatos }), [refrescarDatos]);

  // Carga inicial. Los ajustes (tiempos de carga) solo se piden aquí: no
  // cambian en tiempo real, así que el refresco periódico no los reconsulta.
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      api.get('/notas'),
      api.get('/maquinas'),
      api.get('/ajustes').catch(() => null),
    ])
      .then(([n, m, a]) => {
        if (cancelado) return;
        if (Array.isArray(n)) setNotas(n);
        if (Array.isArray(m)) setMaquinas(m);
        if (a) {
          setTiempos({
            mediana:  a.tiempo_carga_mediana  != null ? Number(a.tiempo_carga_mediana)  : 30,
            jumbo:    a.tiempo_carga_jumbo    != null ? Number(a.tiempo_carga_jumbo)    : 45,
            secadora: a.tiempo_carga_secadora != null ? Number(a.tiempo_carga_secadora) : 30,
          });
        }

        // Reanudar una acción pendiente (p. ej. "Procesar carga" que quedó a
        // medias porque expiró la sesión): reabrimos la confirmación sobre esa
        // máquina, solo si sigue existiendo y en uso. El operador la confirma
        // de nuevo.
        const accion = leerAccionPendiente();
        if (accion?.tipo === 'procesar' && Array.isArray(m)) {
          limpiarAccionPendiente();
          const maquina = m.find(mq => String(mq.id) === String(accion.maquinaId));
          if (maquina && maquina.estado === 'en_uso') {
            setConfirmProcesar(maquina);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, []);

  // Auto-refresco periódico + al volver a la pestaña (solo si está visible).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refrescarDatos();
    }, REFRESCO_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') refrescarDatos();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refrescarDatos]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Reporta el número de máquinas en uso al contenedor (p. ej. el nav de la
  // página Máquinas lo muestra como subtítulo).
  useEffect(() => {
    onCountChange?.(maquinas.filter(m => m.estado === 'en_uso').length);
  }, [maquinas, onCountChange]);

  const notaParaProcesar = confirmProcesar
    ? notas
        .filter(n => String(n.maquina_id) === String(confirmProcesar.id)
                  && ['EN_PROCESO', 'POR_PROCESAR'].includes(n.estado))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;

  const confirmarProcesar = async () => {
    if (!confirmProcesar) return;
    setProcesando(true);
    setErrorProcesar('');
    // Si la sesión expira a mitad de esto, la app redirige a /login y se pierde
    // el contexto; guardamos la intención para reabrir esta confirmación al
    // volver a entrar (api.patch devuelve undefined en ese caso 401).
    guardarAccionPendiente({ tipo: 'procesar', maquinaId: confirmProcesar.id });
    try {
      if (notaParaProcesar) {
        const notaActualizada = await api.patch(`/notas/${notaParaProcesar.id}/estado`, { estado: 'LISTA' });
        if (notaActualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      }
      const actualizada = await api.patch(`/maquinas/${confirmProcesar.id}/estado`, { estado: 'disponible' });
      if (actualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
      limpiarAccionPendiente();
      setMaquinas(prev => prev.map(m => m.id === actualizada.id ? actualizada : m));
      setConfirmProcesar(null);
    } catch (err) {
      limpiarAccionPendiente();
      setErrorProcesar(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const maquinasEnUso = maquinas.filter(m => m.estado === 'en_uso');

  return (
    <div>
      {showHeader && (
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-section text-dark-blue">
            Máquinas en uso <span className="text-grey">({maquinasEnUso.length})</span>
          </h2>
          <button
            type="button"
            onClick={refrescarManual}
            disabled={refrescando}
            aria-label="Recargar máquinas"
            title="Recargar"
            className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center text-dark-blue hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            <svg
              className={`w-5 h-5 ${refrescando ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
            >
              <path d="M20 11A8.1 8.1 0 004.5 9M4 5v4h4" />
              <path d="M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
            </svg>
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-card bg-white py-20 shadow-card flex justify-center">
          <div className="animate-spin rounded-pill h-8 w-8 border-b-2 border-blue" />
        </div>
      ) : maquinasEnUso.length === 0 ? (
        <div className="rounded-card bg-white py-20 shadow-card text-center">
          <p className="text-md text-grey">Sin máquinas en uso</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
          {maquinasEnUso.map(m => {
            const minutos = m.tipo === 'secadora'       ? tiempos.secadora
                          : m.tipo === 'lavadora_jumbo' ? tiempos.jumbo
                          : tiempos.mediana;
            const duracionSeg = Math.max(0, Number(minutos) || 0) * 60;
            const inicio = m.en_uso_desde ? new Date(m.en_uso_desde).getTime() : null;
            const transcurridoSeg = inicio ? Math.max(0, Math.floor((now - inicio) / 1000)) : 0;
            const restanteSeg = Math.max(0, duracionSeg - transcurridoSeg);
            const progreso = duracionSeg > 0 ? restanteSeg / duracionSeg : 0;
            // La nota relacionada y su estado son la fuente de verdad: el
            // servidor promueve a POR_PROCESAR al cumplirse el tiempo. El
            // contador de abajo es solo referencia visual del ciclo.
            const notaRel = notas
              .filter(n => String(n.maquina_id) === String(m.id)
                        && ['EN_PROCESO', 'POR_PROCESAR'].includes(n.estado))
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            const maquinaAumentada = {
              ...m,
              progreso,
              tiempo_restante: inicio ? formatMMSS(restanteSeg) : '—:—',
              necesita_procesar: notaRel?.estado === 'POR_PROCESAR',
            };
            return (
              <MachineCard
                key={m.id}
                maquina={maquinaAumentada}
                nota={notaRel}
                onProcesar={() => setConfirmProcesar(maquinaAumentada)}
                onClick={notaRel ? () => navigate(`/notas/${notaRel.id}`) : undefined}
              />
            );
          })}
        </div>
      )}

      {confirmProcesar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Procesar carga</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmProcesar.nombre}</span> ya terminó? La máquina pasará a disponible.
            </p>
            {notaParaProcesar && (
              <p className="text-sm text-gray-500">
                La nota <span className="font-semibold text-gray-800">{notaParaProcesar.folio ?? `#${notaParaProcesar.id}`}</span> pasará a estado <span className="font-semibold text-gray-800">"Por Entregar"</span>.
              </p>
            )}
            {errorProcesar && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorProcesar}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmProcesar(null); setErrorProcesar(''); }}
                disabled={procesando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarProcesar}
                disabled={procesando}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {procesando ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MaquinasEnUso;
