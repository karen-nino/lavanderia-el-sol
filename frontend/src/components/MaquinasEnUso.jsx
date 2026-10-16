import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import MachineCard from './MachineCard';
import MaquinaCicloOverlay from './MaquinaCicloOverlay';
import ElegirTiempoModal from './ElegirTiempoModal';
import { preguntaTiempo, tiemposDeMaquina } from '../lib/tiemposModelo';
import { marcaYTamano } from '../lib/estadoMaquina';

/** Cada cuánto se vuelven a consultar notas y máquinas. */
const REFRESCO_MS = 15000;

/** Giro mínimo del botón de recargar, para que se note el clic. */
const GIRO_MIN_MS = 400;

const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * Acción que no se completó porque expiró la sesión: se guarda para reabrir la
 * confirmación al volver a entrar.
 */
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

/**
 * Máquinas en uso: tarjetas con su reloj y la confirmación de Finalizar. Consulta
 * y refresca sus propios datos (página Máquinas y Dashboard).
 *
 * @param showHeader encabezado propio ("Máquinas en uso (n)" y recargar). La
 *   página Máquinas lo oculta y usa `onCountChange`, `onErrorRefresco` y el
 *   método `refrescar` (por ref).
 * @param layout 'grid' (Máquinas) o 'carousel' (Dashboard: Lavadoras y Secadoras).
 */
const MaquinasEnUso = forwardRef(function MaquinasEnUso({ showHeader = true, onCountChange, onErrorRefresco, layout = 'grid' }, ref) {
  const navigate = useNavigate();
  const [notas, setNotas]       = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [tiempos, setTiempos]   = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(() => Date.now());
  const [confirmTerminar, setConfirmTerminar] = useState(null);
  // Secadora esperando que se elija su programa antes de arrancar.
  const [eligiendoTiempo, setEligiendoTiempo] = useState(null);
  // Máquina de botón Iniciar que pregunta su programa: espera la elección.
  const [eligiendoArranque, setEligiendoArranque] = useState(null);
  // Secadora que arranca al terminar el lavado (para la animación).
  const [iniciandoSecadora, setIniciandoSecadora] = useState(null);
  const [secadoraSel, setSecadoraSel] = useState('');
  const [terminando, setTerminando] = useState(false);
  const [errorTerminar, setErrorTerminar] = useState('');
  const [refrescando, setRefrescando] = useState(false);
  // Error de la recarga manual (el refresco automático no avisa).
  const [errorRefresco, setErrorRefresco] = useState('');
  // Otro ciclo en curso y su error, por máquina.
  const [otroCicloEnCurso, setOtroCicloEnCurso] = useState(null);
  const [errorOtroCiclo, setErrorOtroCiclo] = useState(null);
  // Máquina recibiendo corriente para el siguiente ciclo (animación).
  const [encendiendoMaquina, setEncendiendoMaquina] = useState(null);

  // Refresco silencioso: ignora los fallos y reintenta en el siguiente ciclo.
  // Devuelve si trajo datos (la recarga manual avisa si no); un éxito borra el error.
  const refrescarDatos = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([
        api.get('/notas'),
        api.get('/maquinas'),
      ]);
      // Sesión expirada: api redirige y devuelve undefined.
      if (!Array.isArray(n) || !Array.isArray(m)) return false;
      setNotas(n);
      setMaquinas(m);
      setErrorRefresco('');
      return true;
    } catch {
      // Se reintenta en el siguiente ciclo.
      return false;
    }
  }, []);

  // Recarga manual: gira al menos GIRO_MIN_MS y avisa si falla.
  const refrescarManual = useCallback(async () => {
    setRefrescando(true);
    setErrorRefresco('');
    try {
      // Primero se pide al servidor que lea los Sonoff ya (una encendida a mano que
      // apagaron se suelta al momento); si falla, se refresca igual.
      const leer = api.post('/maquinas/revisar-sonoff').catch(() => null);
      const [ok] = await Promise.all([leer.then(() => refrescarDatos()), esperar(GIRO_MIN_MS)]);
      if (!ok) setErrorRefresco('No se pudo actualizar');
      return ok;
    } finally {
      setRefrescando(false);
    }
  }, [refrescarDatos]);

  // Permite al contenedor disparar el refresco (devuelve la promesa).
  useImperativeHandle(ref, () => ({ refrescar: refrescarManual }), [refrescarManual]);

  // Carga inicial. Los ajustes (tiempos) solo aquí: no cambian en tiempo real.
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

        // Reanuda una acción que quedó pendiente por sesión expirada: reabre la
        // confirmación si la máquina sigue en uso.
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

  // Número de máquinas en uso para el contenedor.
  useEffect(() => {
    onCountChange?.(maquinas.filter(m => m.estado === 'en_uso').length);
  }, [maquinas, onCountChange]);

  // Avisa al contenedor si la recarga manual falló.
  useEffect(() => {
    onErrorRefresco?.(errorRefresco);
  }, [errorRefresco, onErrorRefresco]);

  // La nota usa la máquina si aparece en sus cargas (maquinas_ids).
  const notaUsaMaquina = (n, maquinaId) =>
    Array.isArray(n.maquinas_ids) &&
    n.maquinas_ids.some(mid => String(mid) === String(maquinaId));

  const notaParaTerminar = confirmTerminar
    ? notas
        .filter(n => notaUsaMaquina(n, confirmTerminar.id)
                  && ['LAVANDO', 'SECANDO'].includes(n.estado))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;

  // Si es una lavadora que encadena secado (`lavadoras_con_secado_ids`: hoy solo
  // Autoservicio), terminar es pasar la carga a una secadora y hay que elegirla.
  // Por Encargo finaliza directo; su secadora va aparte en Salidas.
  const terminaLavado = Boolean(
    confirmTerminar && confirmTerminar.tipo !== 'secadora' && notaParaTerminar
    && Array.isArray(notaParaTerminar.lavadoras_con_secado_ids)
    && notaParaTerminar.lavadoras_con_secado_ids.some(
         mid => String(mid) === String(confirmTerminar.id))
  );
  const secadorasDisponibles = maquinas.filter(m => m.tipo === 'secadora' && m.estado === 'disponible');
  // ¿La nota tiene otras máquinas en uso?
  const otrasEnUso = Boolean(confirmTerminar && notaParaTerminar &&
    maquinas.some(m => String(m.id) !== String(confirmTerminar.id)
      && m.estado === 'en_uso' && notaUsaMaquina(notaParaTerminar, m.id)));
  // Trabajo pendiente que no corre (máquina sin asignar o sin arrancar): la nota
  // no pasa a "Por Entregar" al cerrar esta. Lo calcula el servidor.
  const sigueEnProceso = otrasEnUso || Boolean(notaParaTerminar?.trabajo_pendiente);
  // Qué le pasa a la nota si esta era su última máquina (como
  // estadoAlTerminarCargas del servidor):
  // - Autoservicio cobrado → se finaliza (el cliente se lleva su ropa).
  // - Autoservicio que debe → "Por Cobrar".
  // - Por Encargo → no avanza: espera "Procesado".
  // - Edredón → "Por Entregar".
  const tipoTerminar = notaParaTerminar?.tipo_servicio;
  const esAutoservicioTerminar = tipoTerminar === 'AUTOSERVICIO';
  const estadoAlCerrar = tipoTerminar === 'POR_ENCARGO' ? null
    : !esAutoservicioTerminar ? 'Por Entregar'
    : notaParaTerminar?.estado_pago === 'PAGADO' ? 'Finalizada' : 'Por Cobrar';

  const confirmarTerminarCiclo = async (minutosElegidos = null) => {
    if (!confirmTerminar) return;
    if (terminaLavado && !secadoraSel) return;
    // Si la secadora pregunta su programa, se pregunta antes de nada.
    const secElegida = terminaLavado
      ? secadorasDisponibles.find(m => String(m.id) === String(secadoraSel)) : null;
    if (terminaLavado && minutosElegidos == null) {
      if (preguntaTiempo(secElegida)) { setEligiendoTiempo(secElegida); return; }
    }
    setTerminando(true);
    setErrorTerminar('');
    // Si la sesión expira a medias, se guarda la intención para reabrir esta
    // confirmación (api.patch devuelve undefined con 401).
    guardarAccionPendiente({ tipo: 'terminar_ciclo', maquinaId: confirmTerminar.id });
    try {
      if (terminaLavado) {
        // Termina el lavado de esta lavadora y arranca la secadora elegida; la nota
        // pasa a Secando (o sigue Lavando). Con animación de duración mínima.
        setIniciandoSecadora(secElegida || null);
        const [notaActualizada] = await Promise.all([
          api.patch(`/notas/${notaParaTerminar.id}/terminar-lavado`, {
            lavadora_id: Number(confirmTerminar.id),
            secadora_id: Number(secadoraSel),
            ...(minutosElegidos != null && { minutos: minutosElegidos }),
          }),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
        if (notaActualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      } else if (notaParaTerminar) {
        // Finaliza la carga de esta máquina: secadora → terminar-secado; lavadora →
        // terminar-lavado-final.
        const esSecadora = confirmTerminar.tipo === 'secadora';
        const notaActualizada = esSecadora
          ? await api.patch(`/notas/${notaParaTerminar.id}/terminar-secado`, { secadora_id: Number(confirmTerminar.id) })
          : await api.patch(`/notas/${notaParaTerminar.id}/terminar-lavado-final`, { lavadora_id: Number(confirmTerminar.id) });
        if (notaActualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setNotas(prev => prev.map(n => n.id === notaActualizada.id ? { ...n, ...notaActualizada } : n));
      } else {
        // En uso sin nota: solo se libera.
        const actualizada = await api.patch(`/maquinas/${confirmTerminar.id}/estado`, { estado: 'disponible' });
        if (actualizada === undefined) return; // sesión expiró: se conserva la acción pendiente
        setMaquinas(prev => prev.map(m => m.id === actualizada.id ? actualizada : m));
      }
      limpiarAccionPendiente();
      setConfirmTerminar(null);
      setSecadoraSel('');
      setEligiendoTiempo(null);
      // La nota pudo soltar o tomar máquinas: se refresca.
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

  // Datos de la tarjeta: reloj del ciclo y su nota. Finalizar es por máquina y
  // sale cuando esta cumple su tiempo, aunque otras sigan corriendo.
  const datosDeCiclo = (m) => {
    // Ciclo sellado al arrancar (ciclo_minutos) o, si no hay, el de su tipo. La de
    // fichas no tiene tope: su reloj solo sube.
    const minutos = m.solo_fichas ? 0
                  : m.ciclo_minutos != null ? m.ciclo_minutos
                  : m.tipo === 'secadora'       ? tiempos.secadora
                  : m.tipo === 'lavadora_jumbo' ? tiempos.jumbo
                  : tiempos.mediana;
    const duracionSeg = Math.max(0, Number(minutos) || 0) * 60;
    const inicio = m.en_uso_desde ? new Date(m.en_uso_desde).getTime() : null;
    const transcurridoSeg = inicio ? Math.max(0, Math.floor((now - inicio) / 1000)) : 0;
    const restanteSeg = Math.max(0, duracionSeg - transcurridoSeg);
    const progreso = duracionSeg > 0 ? restanteSeg / duracionSeg : 0;
    const notaEnProceso = notas
      .filter(n => notaUsaMaquina(n, m.id)
                && ['LAVANDO', 'SECANDO'].includes(n.estado))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    // Encendida esperando Iniciar: su nota puede seguir En espera; se toma la de la máquina.
    const notaRel = notaEnProceso ?? (m.esperando_arranque && m.en_uso_nota_id
      ? (notas.find(n => String(n.id) === String(m.en_uso_nota_id))
         ?? { id: m.en_uso_nota_id, folio: m.en_uso_folio })
      : undefined);
    // Encendida a mano y sin nota: no hay ciclo que contar.
    const soloManual = Boolean(m.encendida_manual_at) && !notaRel;
    // Otro ciclo de la misma carga: `otro_ciclo_desde` lo calcula el backend; aquí
    // solo se cuenta hacia atrás.
    const habilitaEn = m.otro_ciclo_desde ? new Date(m.otro_ciclo_desde).getTime() : null;
    const esperaSeg = habilitaEn ? Math.max(0, Math.ceil((habilitaEn - now) / 1000)) : 0;
    // Con cronómetro cuenta hacia arriba y termina al finalizarla. `ciclo_minutos`
    // es su tope: ahí se corta la luz y el reloj se para. Con programa elegido, al
    // cumplirlo se avisa.
    if (m.cronometro && !soloManual) {
      const programaSeg = Math.max(0, Number(m.ciclo_elegido_minutos) || 0) * 60;
      // Secadora de fichas: nunca se le corta la luz; con "Otro ciclo" el reloj
      // llega hasta donde se le acaba el tiempo.
      const deFichas = Number(m.minutos_por_ficha) > 0;
      const limiteSeg = deFichas ? Math.max(duracionSeg, programaSeg) : duracionSeg;
      const contadoSeg = limiteSeg > 0 ? Math.min(transcurridoSeg, limiteSeg) : transcurridoSeg;
      return {
        nota: notaRel,
        maquina: {
          ...m,
          cronometro: true,
          progreso: limiteSeg > 0 ? contadoSeg / limiteSeg : 1,
          tiempo_restante: inicio ? formatMMSS(contadoSeg) : '—:—',
          de_fichas: deFichas,
          tope_alcanzado: !deFichas && inicio != null && duracionSeg > 0 && restanteSeg <= 0,
          programa_cumplido: inicio != null && programaSeg > 0 && transcurridoSeg >= programaSeg,
          necesita_terminar_ciclo: false,
          puede_otro_ciclo: false,
          espera_otro_ciclo: 0,
        },
      };
    }
    return {
      nota: notaRel,
      maquina: {
        ...m,
        progreso: soloManual ? 1 : progreso,
        tiempo_restante: soloManual || !inicio ? '—:—' : formatMMSS(restanteSeg),
        necesita_terminar_ciclo: Boolean(notaRel) && inicio != null && restanteSeg <= 0,
        puede_otro_ciclo: Boolean(notaRel) && habilitaEn != null,
        espera_otro_ciclo: esperaSeg,
      },
    };
  };

  // Pide el siguiente ciclo, sin confirmación (el backend revalida tope y pausa).
  const pedirOtroCiclo = async (maquina, minutos = null) => {
    // Botón Iniciar recién encendida: es el primer arranque, no otro ciclo (si
    // pregunta su programa, se elige antes).
    const primerArranque = maquina.con_iniciar && maquina.esperando_arranque
      && maquina.en_uso_nota_id && maquina.ciclos_carga == null;
    if (primerArranque && minutos == null && preguntaTiempo(maquina)) {
      setEligiendoArranque(maquina);
      return;
    }
    setEligiendoArranque(null);
    setErrorOtroCiclo(null);
    setOtroCicloEnCurso(String(maquina.id));
    try {
      const r = primerArranque
        ? await api.patch(`/notas/${maquina.en_uso_nota_id}/activar-pendientes`, {
            maquina_id: maquina.id, ...(minutos != null && { minutos }),
          })
        : await api.patch(`/maquinas/${maquina.id}/otro-ciclo`, {});
      // Sesión expirada: api redirige y devuelve undefined.
      if (r) await refrescarDatos();
    } catch (err) {
      setErrorOtroCiclo({
        id: String(maquina.id),
        mensaje: err?.message || 'No se pudo iniciar el siguiente ciclo.',
      });
    } finally {
      setOtroCicloEnCurso(null);
    }
  };

  // Le devuelve la corriente para el siguiente ciclo sin arrancar el cronómetro
  // (como "Encender máquina" de Salidas).
  const encenderParaOtroCiclo = async (maquina, notaRel) => {
    if (!notaRel) return;
    setErrorOtroCiclo(null);
    setOtroCicloEnCurso(String(maquina.id));
    setEncendiendoMaquina(maquina);
    try {
      const r = await Promise.all([
        api.patch(`/notas/${notaRel.id}/encender-maquina`, { maquina_id: maquina.id }),
        // Mínimo para que la animación de encendido se alcance a ver.
        new Promise((res) => setTimeout(res, 1800)),
      ]);
      if (r[0]) await refrescarDatos();
    } catch (err) {
      setErrorOtroCiclo({
        id: String(maquina.id),
        mensaje: err?.message || 'No se pudo encender la máquina.',
      });
    } finally {
      setOtroCicloEnCurso(null);
      setEncendiendoMaquina(null);
    }
  };

  // Elegir el programa de la secadora; aparte del modal de confirmación.
  const modalElegirTiempo = eligiendoTiempo && (
    <ElegirTiempoModal
      maquina={eligiendoTiempo}
      tiempos={tiemposDeMaquina(eligiendoTiempo)}
      guardando={terminando}
      error={errorTerminar}
      onElegir={(min) => confirmarTerminarCiclo(min)}
      onCancelar={() => { setEligiendoTiempo(null); setErrorTerminar(''); }}
    />
  );

  const modalElegirArranque = eligiendoArranque && (
    <ElegirTiempoModal
      maquina={eligiendoArranque}
      tiempos={tiemposDeMaquina(eligiendoArranque)}
      onElegir={(min) => pedirOtroCiclo(eligiendoArranque, min)}
      onCancelar={() => setEligiendoArranque(null)}
    />
  );

  const renderCard = (m) => {
    const { maquina: maquinaAumentada, nota: notaRel } = datosDeCiclo(m);
    return (
      <MachineCard
        key={m.id}
        maquina={maquinaAumentada}
        nota={notaRel}
        onTerminarCiclo={() => { setSecadoraSel(''); setConfirmTerminar(maquinaAumentada); }}
        onOtroCiclo={() => pedirOtroCiclo(maquinaAumentada)}
        onEncender={() => encenderParaOtroCiclo(maquinaAumentada, notaRel)}
        otroCicloEnCurso={otroCicloEnCurso === String(m.id)}
        errorOtroCiclo={errorOtroCiclo?.id === String(m.id) ? errorOtroCiclo.mensaje : null}
        onClick={notaRel ? () => navigate(`/notas/${notaRel.id}`) : undefined}
      />
    );
  };

  // El aviso sonoro de fin de ciclo vive en el Layout (lib/avisoTope.js).

  // Un carrusel por tipo, con "en uso/total" en el título.
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
              <div>
                <h2 className="text-section text-dark-blue">
                  Máquinas en uso <span className="text-grey">({maquinasEnUso.length})</span>
                </h2>
                {errorRefresco && <p className="text-sm text-red-600">{errorRefresco}</p>}
              </div>
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
                  {/* En espejo: se voltea el dibujo y no el <svg>, para que el giro no lo deshaga. */}
                  <g transform="matrix(-1 0 0 1 24 0)">
                    <path d="M20 11A8.1 8.1 0 004.5 9M4 5v4h4" />
                    <path d="M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4" />
                  </g>
                </svg>
              </button>
            </div>
          )}

          {loading ? (
            <div className="rounded-card bg-white py-20 shadow-card flex justify-center">
              <div className="animate-spin rounded-pill h-8 w-8 border-b-2 border-blue" />
            </div>
          ) : (
            // Lavadoras y Secadoras por separado, cada una con "en uso/total".
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
                    /* Las que quepan; abajo de 392 px, fijo 2 (si no, saldría 1). */
                    <div className="grid grid-cols-2 min-[392px]:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-6">
                      {grupo.items.map(renderCard)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {modalElegirTiempo}
      {modalElegirArranque}

      {/* Corriente para el siguiente ciclo: la animación de "Encender máquina". */}
      {encendiendoMaquina && (
        <MaquinaCicloOverlay modo="encender" tipo={encendiendoMaquina.tipo} nombre={encendiendoMaquina.nombre} />
      )}

      {/* Animación de arranque de la secadora al terminar el lavado (como en Salidas) */}
      {iniciandoSecadora && (
        <MaquinaCicloOverlay modo="iniciar" tipo={iniciandoSecadora.tipo} nombre={iniciandoSecadora.nombre} />
      )}

      {confirmTerminar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">{terminaLavado ? 'Iniciar secado' : confirmTerminar.cronometro && !confirmTerminar.solo_fichas ? 'Finalizar y apagar' : confirmTerminar.cronometro ? 'Finalizar' : 'Terminar ciclo'}</h3>
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
                          {/* "Marca · Tamaño"; sin datos, al menos qué es. */}
                          <span className="text-xs text-gray-500">{marcaYTamano(m) ?? 'Secadora'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmTerminar.nombre}</span> ya terminó? {confirmTerminar.cronometro && !confirmTerminar.solo_fichas
                    ? 'Se le cortará la luz y pasará a disponible.'
                    : 'La máquina pasará a disponible.'}
                </p>
                {notaParaTerminar && (
                  sigueEnProceso ? (
                    <p className="text-sm text-gray-500">
                      La nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span> sigue en proceso
                      {otrasEnUso
                        ? ': sus demás cargas todavía están en máquina.'
                        : ': le queda otra máquina por asignar o por arrancar.'}
                      {estadoAlCerrar && ` Aún no pasa a "${estadoAlCerrar}".`}
                    </p>
                  ) : estadoAlCerrar ? (
                    <p className="text-sm text-gray-500">
                      La nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span> pasará a estado <span className="font-semibold text-gray-800">"{estadoAlCerrar}"</span>
                      {esAutoservicioTerminar && ` ya que es de autoservicio${estadoAlCerrar === 'Finalizada' ? ' y ya está cobrada' : ''}`}.
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">
                      La nota <span className="font-semibold text-gray-800">{notaParaTerminar.folio ?? `#${notaParaTerminar.id}`}</span> se queda en espera hasta que la marques como <span className="font-semibold text-gray-800">Procesado</span> en su detalle.
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
                onClick={() => confirmarTerminarCiclo()}
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
