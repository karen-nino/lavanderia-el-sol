import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import KpiCard from '../components/KpiCard';
import MachineCard from '../components/MachineCard';
import SalesCard from '../components/SalesCard';
import CashCutCard from '../components/CashCutCard';

// Icono de notas (info/notes.svg). Hereda el color con currentColor.
const notesIcon = (
  <svg className="w-full h-full scale-90" viewBox="0 0 59 59" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.75 14.75C14.75 14.098 15.009 13.4727 15.47 13.0117C15.9311 12.5507 16.5563 12.2917 17.2083 12.2917H41.7917C42.4437 12.2917 43.0689 12.5507 43.53 13.0117C43.991 13.4727 44.25 14.098 44.25 14.75C44.25 15.402 43.991 16.0273 43.53 16.4883C43.0689 16.9493 42.4437 17.2083 41.7917 17.2083H17.2083C16.5563 17.2083 15.9311 16.9493 15.47 16.4883C15.009 16.0273 14.75 15.402 14.75 14.75ZM14.75 24.5833C14.75 23.9313 15.009 23.306 15.47 22.845C15.9311 22.384 16.5563 22.125 17.2083 22.125H41.7917C42.4437 22.125 43.0689 22.384 43.53 22.845C43.991 23.306 44.25 23.9313 44.25 24.5833C44.25 25.2353 43.991 25.8606 43.53 26.3216C43.0689 26.7827 42.4437 27.0417 41.7917 27.0417H17.2083C16.5563 27.0417 15.9311 26.7827 15.47 26.3216C15.009 25.8606 14.75 25.2353 14.75 24.5833ZM17.2083 31.9583C16.5563 31.9583 15.9311 32.2173 15.47 32.6784C15.009 33.1394 14.75 33.7647 14.75 34.4167C14.75 35.0686 15.009 35.6939 15.47 36.155C15.9311 36.616 16.5563 36.875 17.2083 36.875H41.7917C42.4437 36.875 43.0689 36.616 43.53 36.155C43.991 35.6939 44.25 35.0686 44.25 34.4167C44.25 33.7647 43.991 33.1394 43.53 32.6784C43.0689 32.2173 42.4437 31.9583 41.7917 31.9583H17.2083ZM14.75 44.25C14.75 43.598 15.009 42.9727 15.47 42.5117C15.9311 42.0507 16.5563 41.7917 17.2083 41.7917H27.0417C27.6937 41.7917 28.3189 42.0507 28.78 42.5117C29.241 42.9727 29.5 43.598 29.5 44.25C29.5 44.902 29.241 45.5273 28.78 45.9883C28.3189 46.4493 27.6937 46.7083 27.0417 46.7083H17.2083C16.5563 46.7083 15.9311 46.4493 15.47 45.9883C15.009 45.5273 14.75 44.902 14.75 44.25Z" fill="currentColor"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M4.91663 9.83334C4.91663 7.87737 5.69363 6.00151 7.07671 4.61843C8.45979 3.23535 10.3357 2.45834 12.2916 2.45834H46.7083C48.6643 2.45834 50.5401 3.23535 51.9232 4.61843C53.3063 6.00151 54.0833 7.87737 54.0833 9.83334V49.1667C54.0833 51.1226 53.3063 52.9985 51.9232 54.3816C50.5401 55.7647 48.6643 56.5417 46.7083 56.5417H12.2916C10.3357 56.5417 8.45979 55.7647 7.07671 54.3816C5.69363 52.9985 4.91663 51.1226 4.91663 49.1667V9.83334ZM12.2916 7.37501H46.7083C47.3603 7.37501 47.9856 7.63401 48.4466 8.09504C48.9076 8.55607 49.1666 9.18135 49.1666 9.83334V49.1667C49.1666 49.8187 48.9076 50.444 48.4466 50.905C47.9856 51.366 47.3603 51.625 46.7083 51.625H12.2916C11.6396 51.625 11.0143 51.366 10.5533 50.905C10.0923 50.444 9.83329 49.8187 9.83329 49.1667V9.83334C9.83329 9.18135 10.0923 8.55607 10.5533 8.09504C11.0143 7.63401 11.6396 7.37501 12.2916 7.37501Z" fill="currentColor"/>
  </svg>
);

const KpiIcon = {
  machine: (
    <svg className="w-full h-full" viewBox="0 0 66 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M51.704 5.33331H14.3706C12.8979 5.33331 11.704 6.52722 11.704 7.99998V56C11.704 57.4727 12.8979 58.6666 14.3706 58.6666H51.704C53.1767 58.6666 54.3707 57.4727 54.3707 56V7.99998C54.3707 6.52722 53.1767 5.33331 51.704 5.33331Z" stroke="currentColor" strokeWidth="5.33333"/>
      <path d="M11.704 20.6667H54.3707" stroke="currentColor" strokeWidth="5.33333" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M38.371 11.3336C39.4754 11.3338 40.371 12.2292 40.371 13.3336C40.3708 14.438 39.4753 15.3335 38.371 15.3336C37.2665 15.3336 36.3711 14.4381 36.371 13.3336C36.371 12.2291 37.2664 11.3336 38.371 11.3336Z" fill="currentColor" stroke="currentColor" strokeWidth="1.33333"/>
      <path d="M46.371 11.3336C47.4754 11.3338 48.371 12.2292 48.371 13.3336C48.3708 14.438 47.4753 15.3335 46.371 15.3336C45.2665 15.3336 44.3711 14.4381 44.371 13.3336C44.371 12.2291 45.2664 11.3336 46.371 11.3336Z" fill="currentColor" stroke="currentColor" strokeWidth="1.33333"/>
      <path d="M33.0373 49.3333C38.192 49.3333 42.3706 45.1546 42.3706 40C42.3706 34.8453 38.192 30.6667 33.0373 30.6667C27.8827 30.6667 23.704 34.8453 23.704 40C23.704 45.1546 27.8827 49.3333 33.0373 49.3333Z" stroke="currentColor" strokeWidth="5.33333"/>
    </svg>
  ),
  paid:    notesIcon,
  waiting: notesIcon,
  deliver: notesIcon,
};

// Cada cuánto se re-consultan notas, máquinas y ventas en segundo plano.
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

// ¿La fecha cae en el mismo día calendario (hora local) que la referencia?
// Se usa para que los KPIs de la sección "Hoy" cuenten solo notas del día y se
// reinicien al cambiar la fecha, igual que "Ingresado hoy" (filtrado en backend).
function esDeHoy(fecha, refMs) {
  if (!fecha) return false;
  const d = new Date(fecha);
  const r = new Date(refMs);
  return d.getFullYear() === r.getFullYear()
      && d.getMonth()    === r.getMonth()
      && d.getDate()     === r.getDate();
}

function formatMMSS(totalSegundos) {
  const s = Math.max(0, Math.floor(totalSegundos));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [notas, setNotas]       = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [tiempos, setTiempos]   = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [ventas, setVentas]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());
  const [confirmProcesar, setConfirmProcesar] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [errorProcesar, setErrorProcesar] = useState('');
  const [refrescando, setRefrescando] = useState(false);

  // Refresco silencioso de los datos que cambian en tiempo real.
  // No toca `loading` ni muestra errores: los fallos transitorios se ignoran
  // y se reintenta en el siguiente ciclo. Solo escribe si llegó un arreglo,
  // para no romper render si la sesión expiró (api redirige y devuelve undefined).
  const refrescarDatos = useCallback(async () => {
    try {
      const [n, m, v] = await Promise.all([
        api.get('/notas'),
        api.get('/maquinas'),
        api.get('/ventas/resumen?periodo=hoy').catch(() => null),
      ]);
      if (Array.isArray(n)) setNotas(n);
      if (Array.isArray(m)) setMaquinas(m);
      if (v !== undefined)  setVentas(v);
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

  // Carga inicial (con spinner). Los ajustes solo se piden aquí: no cambian
  // en tiempo real, así que el refresco periódico no los vuelve a consultar.
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      api.get('/notas'),
      api.get('/maquinas'),
      api.get('/ventas/resumen?periodo=hoy').catch(() => null),
      api.get('/ajustes').catch(() => null),
    ])
      .then(([n, m, v, a]) => {
        if (cancelado) return;
        if (Array.isArray(n)) setNotas(n);
        if (Array.isArray(m)) setMaquinas(m);
        if (v !== undefined)  setVentas(v);
        if (a) {
          setTiempos({
            mediana:  a.tiempo_carga_mediana  != null ? Number(a.tiempo_carga_mediana)  : 30,
            jumbo:    a.tiempo_carga_jumbo    != null ? Number(a.tiempo_carga_jumbo)    : 45,
            secadora: a.tiempo_carga_secadora != null ? Number(a.tiempo_carga_secadora) : 30,
          });
        }

        // Reanudar una acción pendiente (p. ej. "Procesar carga" que quedó a medias
        // porque expiró la sesión): reabrimos la confirmación sobre esa máquina,
        // solo si sigue existiendo y en uso. El operador la confirma de nuevo.
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

  // KPIs de la sección "Hoy": solo notas creadas hoy (se reinician a medianoche).
  const notasDeHoy       = notas.filter(n => esDeHoy(n.created_at, now));
  const enUso            = maquinas.filter(m => m.estado === 'en_uso').length;
  const notasPagadas     = notasDeHoy.filter(n => n.estado_pago === 'PAGADO').length;
  const notasEnEspera    = notasDeHoy.filter(n => ['EN_PROCESO', 'POR_PROCESAR'].includes(n.estado)).length;
  const paraEntregar     = notasDeHoy.filter(n => ['LISTA', 'PAGADA'].includes(n.estado)).length;
  const ventasHoy        = ventas?.tarjetas?.total_cobrado ?? 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-pill h-8 w-8 border-b-2 border-blue" />
      </div>
    );
  }

  return (
    <div className="pt-4 pb-16 px-6 md:py-10 md:px-8 space-y-16">

      {/* Sección resumen */}

      <div className="space-y-4">
        <p className="text-section text-grey">Hoy</p>

        <SalesCard total={ventasHoy} label="Ingresado hoy" />

        {/* KPIs: 2x2 en mobile, 4 columnas en tablet */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Máquinas"
            sublabel="en Servicio"
            value={enUso}
            color="blue"
            icon={KpiIcon.machine}
          />
          <KpiCard
            label="Notas"
            sublabel="Pagadas"
            value={notasPagadas}
            color="green"
            icon={KpiIcon.paid}
          />
          <KpiCard
            label="Notas"
            sublabel="En Espera"
            value={notasEnEspera}
            color="red"
            icon={KpiIcon.waiting}
          />
          <KpiCard
            label="Notas"
            sublabel="Para Entregar"
            value={paraEntregar}
            color="bronce"
            icon={KpiIcon.deliver}
          />
        </div>
      </div>

      {/* Sección ventas */}

        <div className="space-y-12">
          <div className="space-y-6">
            <p className="text-section text-grey">Corte de caja</p>
            <div className="space-y-4">
              <CashCutCard />
            </div>
          </div>
        </div>

      {/* Sección máquinas */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-section text-dark-blue">Máquinas en uso <span className="text-grey">({enUso})</span></h2>
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

          {(() => {
            const maquinasEnUso = maquinas.filter(m => m.estado === 'en_uso');
            if (maquinasEnUso.length === 0) {
              return (
                <div className="rounded-card bg-white py-20 shadow-card text-center">
                  <p className="text-md text-grey">Sin máquinas en uso</p>
                </div>
              );
            }
            return (
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
            );
          })()}
        </div>
      </div>

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

      <Link
        to="/notas/nueva"
        aria-label="Nueva nota"
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 w-16 h-16 rounded-pill bg-blue text-white shadow-card flex items-center justify-center hover:opacity-90 transition-opacity z-40"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>
    </div>
  );
}
