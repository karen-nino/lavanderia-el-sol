import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import MachineCard from './MachineCard';
import MaquinaCicloOverlay from './MaquinaCicloOverlay';

// Cada cuánto se re-consultan notas y máquinas en segundo plano.
const REFRESCO_MS = 15000;

// Acción que el operador intentó pero no se completó porque la sesión expiró
// (la app redirige a /login). Se persiste para reabrir la confirmación al
// volver a entrar. Ver confirmarTerminarCiclo y la reanudación en la carga inicial.
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
// "Terminar ciclo". Es autónomo (consulta sus propios datos y se auto-refresca)
// para poder usarse tanto en la página Máquinas como en el Dashboard.
//
// `showHeader`: muestra el encabezado propio ("Máquinas en uso (n)" + botón de
// recargar). La página Máquinas lo oculta y lleva el título/conteo al nav (vía
// `onCountChange`) y el refresco a su botón (vía el método `refrescar` expuesto
// por ref).
//
// `layout`: 'grid' (por defecto, página Máquinas) muestra todas las máquinas en
// uso en una sola rejilla. 'carousel' (Dashboard) las agrupa en dos carruseles
// horizontales — Lavadoras y Secadoras — cada uno con su conteo "en uso/total".
const MaquinasEnUso = forwardRef(function MaquinasEnUso({ showHeader = true, onCountChange, layout = 'grid' }, ref) {
  const navigate = useNavigate();
  const [notas, setNotas]       = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [tiempos, setTiempos]   = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());
  const [confirmTerminar, setConfirmTerminar] = useState(null);
  // Secadora que arranca al terminar el lavado (para la animación de ciclo).
  const [iniciandoSecadora, setIniciandoSecadora] = useState(null);
  const [secadoraSel, setSecadoraSel] = useState('');
  const [terminando, setTerminando] = useState(false);
  const [errorTerminar, setErrorTerminar] = useState('');
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

        // Reanudar una acción pendiente (p. ej. "Terminar ciclo" que quedó a
        // medias porque expiró la sesión): reabrimos la confirmación sobre esa
        // máquina, solo si sigue existiendo y en uso. El operador la confirma
        // de nuevo.
        const accion = leerAccionPendiente();
        if (accion?.tipo === 'terminar_ciclo' && Array.isArray(m)) {
          limpiarAccionPendiente();
          const maquina = m.find(mq => String(mq.id) === String(accion.maquinaId));
          if (maquina && maquina.estado === 'en_uso') {
            setConfirmTerminar(maquina);
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

  // Una nota está vinculada a la máquina si esta aparece en cualquiera de sus
  // cargas (maquinas_ids, calculado por el servidor).
  const notaUsaMaquina = (n, maquinaId) =>
    Array.isArray(n.maquinas_ids) &&
    n.maquinas_ids.some(mid => String(mid) === String(maquinaId));

  const notaParaTerminar = confirmTerminar
    ? notas
        .filter(n => notaUsaMaquina(n, confirmTerminar.id)
                  && ['LAVANDO', 'SECANDO'].includes(n.estado))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;

  // ¿La máquina por terminar es una lavadora con nota? Entonces el ciclo que
  // termina es el lavado: se exige elegir una secadora disponible para pasar
  // esa carga a secado. Si es una secadora, termina su secado; la nota pasa a
  // "Por Entregar" solo si era su última máquina en uso.
  const terminaLavado = Boolean(confirmTerminar && confirmTerminar.tipo !== 'secadora' && notaParaTerminar);
  const secadorasDisponibles = maquinas.filter(m => m.tipo === 'secadora' && m.estado === 'disponible');
  // ¿La nota tiene otras máquinas en uso además de esta? (otras cargas
  // lavando o secando: al terminar esta, la nota sigue en proceso)
  const otrasEnUso = Boolean(confirmTerminar && notaParaTerminar &&
    maquinas.some(m => String(m.id) !== String(confirmTerminar.id)
      && m.estado === 'en_uso' && notaUsaMaquina(notaParaTerminar, m.id)));

  const confirmarTerminarCiclo = async () => {
    if (!confirmTerminar) return;
    if (terminaLavado && !secadoraSel) return;
    setTerminando(true);
    setErrorTerminar('');
    // Si la sesión expira a mitad de esto, la app redirige a /login y se pierde
    // el contexto; guardamos la intención para reabrir esta confirmación al
    // volver a entrar (api.patch devuelve undefined en ese caso 401).
    guardarAccionPendiente({ tipo: 'terminar_ciclo', maquinaId: confirmTerminar.id });
    try {
      if (terminaLavado) {
        // Termina el lavado de ESTA lavadora: el servidor la libera, arranca
        // la secadora elegida y la nota pasa a Secando (o sigue Lavando si
        // otras cargas siguen en lavadora). Las demás cargas no se tocan.
        // Se muestra la animación de arranque de la secadora (como en Salidas),
        // con una duración mínima para que alcance a verse.
        const secadora = secadorasDisponibles.find(m => String(m.id) === String(secadoraSel));
        setIniciandoSecadora(secadora || null);
        const [notaActualizada] = await Promise.all([
          api.patch(`/notas/${notaParaTerminar.id}/terminar-lavado`, {
            lavadora_id: Number(confirmTerminar.id),
            secadora_id: Number(secadoraSel),
          }),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
        if (notaActualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      } else if (notaParaTerminar) {
        // Termina el secado de ESTA secadora: el servidor la libera y, si era
        // la última máquina de la nota, la pasa a "Por Entregar".
        const notaActualizada = await api.patch(`/notas/${notaParaTerminar.id}/terminar-secado`, {
          secadora_id: Number(confirmTerminar.id),
        });
        if (notaActualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      } else {
        // Máquina en uso sin nota vinculada: solo se libera.
        const actualizada = await api.patch(`/maquinas/${confirmTerminar.id}/estado`, { estado: 'disponible' });
        if (actualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setMaquinas(prev => prev.map(m => m.id === actualizada.id ? actualizada : m));
      }
      limpiarAccionPendiente();
      setConfirmTerminar(null);
      setSecadoraSel('');
      // La nota pudo liberar o tomar más máquinas (todas las de sus cargas):
      // se refresca para reflejar el estado real.
      refrescarDatos();
    } catch (err) {
      limpiarAccionPendiente();
      setErrorTerminar(err.message);
    } finally {
      setTerminando(false);
      setIniciandoSecadora(null);
    }
  };

  const esLavadora = (m) => m.tipo !== 'secadora';

  const maquinasEnUso = maquinas.filter(m => m.estado === 'en_uso');
  const lavadorasEnUso = maquinasEnUso.filter(esLavadora);
  const secadorasEnUso = maquinasEnUso.filter(m => !esLavadora(m));
  const totalLavadoras = maquinas.filter(esLavadora).length;
  const totalSecadoras = maquinas.length - totalLavadoras;

  // Construye la tarjeta de una máquina en uso: calcula el tiempo restante del
  // ciclo y resuelve su nota relacionada. El botón de terminar es por máquina:
  // aparece cuando ESTA máquina cumple su tiempo, aunque otras cargas de la
  // nota sigan corriendo (cada carga es independiente).
  const renderCard = (m) => {
    // El ciclo se sella al arrancar (ciclo_minutos): imprescindible para el
    // secado, cuya duración depende del tipo de carga, no del tipo de máquina.
    // Fallback por tipo para máquinas puestas en uso antes de la migración.
    const minutos = m.ciclo_minutos != null ? m.ciclo_minutos
                  : m.tipo === 'secadora'       ? tiempos.secadora
                  : m.tipo === 'lavadora_jumbo' ? tiempos.jumbo
                  : tiempos.mediana;
    const duracionSeg = Math.max(0, Number(minutos) || 0) * 60;
    const inicio = m.en_uso_desde ? new Date(m.en_uso_desde).getTime() : null;
    const transcurridoSeg = inicio ? Math.max(0, Math.floor((now - inicio) / 1000)) : 0;
    const restanteSeg = Math.max(0, duracionSeg - transcurridoSeg);
    const progreso = duracionSeg > 0 ? restanteSeg / duracionSeg : 0;
    const notaRel = notas
      .filter(n => notaUsaMaquina(n, m.id)
                && ['LAVANDO', 'SECANDO'].includes(n.estado))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const maquinaAumentada = {
      ...m,
      progreso,
      tiempo_restante: inicio ? formatMMSS(restanteSeg) : '—:—',
      necesita_terminar_ciclo: Boolean(notaRel) && inicio != null && restanteSeg <= 0,
    };
    return (
      <MachineCard
        key={m.id}
        maquina={maquinaAumentada}
        nota={notaRel}
        onTerminarCiclo={() => { setSecadoraSel(''); setConfirmTerminar(maquinaAumentada); }}
        onClick={notaRel ? () => navigate(`/notas/${notaRel.id}`) : undefined}
      />
    );
  };

  // Un carrusel horizontal por tipo, con conteo "en uso/total" en el título.
  const renderCarrusel = (titulo, enUso, total) => (
    <div className="space-y-4">
      <p className="text-section text-grey">
        {titulo} <span className="text-dark-grey">{enUso.length}/{total}</span>
      </p>
      {enUso.length === 0 ? (
        <div className="rounded-card bg-white py-12 shadow-card text-center">
          <p className="text-md text-grey">Sin {titulo.toLowerCase()} en uso</p>
        </div>
      ) : (
        <div className="rounded-card bg-white p-6 shadow-card">
          <div className="flex gap-6 overflow-x-auto pb-3 snap-x">
            {enUso.map(m => (
              <div key={m.id} className="w-44 flex-shrink-0 snap-start">
                {renderCard(m)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {layout === 'carousel' ? (
        loading ? (
          <div className="rounded-card bg-white py-20 shadow-card flex justify-center">
            <div className="animate-spin rounded-pill h-8 w-8 border-b-2 border-blue" />
          </div>
        ) : (
          <div className="space-y-10">
            {renderCarrusel('Lavadoras', lavadorasEnUso, totalLavadoras)}
            {renderCarrusel('Secadoras', secadorasEnUso, totalSecadoras)}
          </div>
        )
      ) : (
        <>
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
          ) : (
            // Separadas en Lavadoras y Secadoras (como Gestión de Máquinas),
            // cada sección con su conteo "en uso/total".
            <div className="space-y-16">
              {[
                { titulo: 'Lavadoras', items: lavadorasEnUso, total: totalLavadoras },
                { titulo: 'Secadoras', items: secadorasEnUso, total: totalSecadoras },
              ].map(grupo => grupo.total > 0 && (
                <section key={grupo.titulo} className="space-y-4">
                  <h2 className="text-section text-dark-blue">
                    {grupo.titulo} <span className="text-grey">{grupo.items.length}/{grupo.total}</span>
                  </h2>
                  {grupo.items.length === 0 ? (
                    <div className="rounded-card bg-white py-12 shadow-card text-center">
                      <p className="text-md text-grey">Sin {grupo.titulo.toLowerCase()} en uso</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                      {grupo.items.map(renderCard)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Animación de arranque de la secadora al terminar el lavado (como en Salidas) */}
      {iniciandoSecadora && (
        <MaquinaCicloOverlay modo="iniciar" tipo={iniciandoSecadora.tipo} nombre={iniciandoSecadora.nombre} />
      )}

      {confirmTerminar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">{terminaLavado ? 'Iniciar secado' : 'Terminar ciclo'}</h3>
            {terminaLavado ? (
              <>
                <p className="text-sm text-gray-500">
                  El lavado en <span className="font-semibold text-gray-800">{confirmTerminar.nombre}</span> terminó y la lavadora pasará a disponible. Elige la secadora donde continúa la nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span>.
                </p>
                {secadorasDisponibles.length === 0 ? (
                  <p className="text-sm text-red-600">
                    No hay secadoras disponibles. Libera una secadora para poder terminar el lavado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {secadorasDisponibles.map(m => {
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
                          <span className="text-xs text-gray-500">
                            Secadora{m.tamano ? ` · ${m.tamano.charAt(0).toUpperCase() + m.tamano.slice(1)}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmTerminar.nombre}</span> ya terminó? La máquina pasará a disponible.
                </p>
                {notaParaTerminar && (
                  otrasEnUso ? (
                    <p className="text-sm text-gray-500">
                      Las demás cargas de la nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span> siguen en proceso; la nota aún no pasa a "Por Entregar".
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">
                      La nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span> pasará a estado <span className="font-semibold text-gray-800">"Por Entregar"</span>.
                    </p>
                  )
                )}
              </>
            )}
            {errorTerminar && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorTerminar}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmTerminar(null); setSecadoraSel(''); setErrorTerminar(''); }}
                disabled={terminando}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarTerminarCiclo}
                disabled={terminando || (terminaLavado && !secadoraSel)}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {terminando
                  ? (terminaLavado ? 'Iniciando...' : 'Terminando...')
                  : (terminaLavado ? 'Iniciar secado' : 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MaquinasEnUso;
