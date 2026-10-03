import { useCallback, useEffect, useRef, useState } from 'react';
import { etiquetaEstadoLista } from '../lib/estadoNota';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { tituloProducto, etiquetaProducto, plural, seVendePorUnidad, esPolvo } from '../lib/formatoInventario';
import { guardarAvisoCobro } from '../lib/avisoCobro';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import MaquinaCicloOverlay from '../components/MaquinaCicloOverlay';
import ConfirmacionModal from '../components/ConfirmacionModal';
import ElegirTiempoModal from '../components/ElegirTiempoModal';
import GranelPorServicio from '../components/GranelPorServicio';
import { preguntaTiempo, tiemposDeMaquina } from '../lib/tiemposModelo';
import { marcaYTamano } from '../lib/estadoMaquina';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

// Palabra de la unidad en que se vendió un producto de la nota, para el
// "$28.00/unidad" del renglón: medida (Por Encargo), bolsa, unidad (marca y
// polvo) o botella (granel líquido). Las mismas que usa Nueva Nota.
function unidadDeRenglon(p) {
  if (p.unidad === 'medida') return 'medida';
  if (p.clase === 'bolsa') return 'bolsa';
  if (seVendePorUnidad(p)) return 'unidad';
  return 'botella';
}

// "Detener Lavado"/"Detener Secado": detener el ciclo libera la máquina en la
// BD y con eso manda apagarla. Estuvo oculto mientras el control de los Sonoff
// estaba desactivado en producción, porque la orden no llegaba al equipo y la
// máquina se quedaba girando con la carga ya dada por terminada. Se vuelve a
// mostrar junto con la reactivación del driver de eWeLink (ver
// CONTEXTO_PROYECTO); esta pantalla la usan también los empleados, que no
// pueden consultar el estado del driver, así que aquí sí es una bandera.
const MOSTRAR_DETENER_CICLO = true;

const BADGE_MAQUINA_ESTADO = {
  // "disponible" aquí = máquina asignada a la carga pero sin iniciar (En espera): gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  // "terminado" = la máquina ya cumplió su parte y se desvinculó de la carga: verde.
  terminado:     { label: 'Terminó',       cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

// ¿La carga lleva un edredón? Es lo único que sigue atando una carga a un
// tamaño de lavadora: no cabe en una mediana. El resto de tamaños dejó de
// filtrar al asignar (2026-09-26).
const esEdredonCarga = (c) => String(c?.tipo_prenda ?? '').toUpperCase() === 'EDREDON';


// Casilla de selección (multiselección de máquinas al asignar).
function SelCheck({ on }) {
  return (
    <span className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
      on ? 'border-blue bg-blue text-white' : 'border-gray-300 bg-white'
    }`}>
      {on && (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

export default function Salidas() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);

  const [nota,            setNota]            = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingMaquina,   setLoadingMaquina]   = useState(false);
  const [loadingProducto,  setLoadingProducto]  = useState(null); // id del producto en proceso
  // Producto de la nota pendiente de confirmar antes de quitarlo (solo admin).
  const [confirmQuitarProd, setConfirmQuitarProd] = useState(null);
  // Agregar un producto a la nota desde Salidas (2026-09-25): el cliente pide
  // el jabón cuando ya está frente a la máquina, no al hacer la nota.
  const [agregarProdOpen, setAgregarProdOpen] = useState(false);
  const [catalogoProd, setCatalogoProd]       = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(false);

  const [confirmQuitarCarga, setConfirmQuitarCarga] = useState(null);
  const [errorAccion,      setErrorAccion]      = useState('');
  const [confirmDetener,   setConfirmDetener]   = useState(null); // máquina a detener
  // Máquina cuyo modal de arranque está abierto. Se guarda el ID y no el
  // objeto: el modal lleva los dos pasos de la mig. 110 (encender y después
  // iniciar) y el paso que toca sale del estado vivo de la máquina, que cambia
  // al encenderla sin cerrar el modal.
  const [maquinaModalId,   setMaquinaModalId]   = useState(null);
  const [iniciando,        setIniciando]        = useState(null); // máquina arrancando (animación)
  // Máquina esperando que se elija con cuál de sus tiempos correr (mig. 120).
  // `{ maquina, paso }`: de qué paso salió el modal de tiempos ('encender' o
  // 'iniciar'), porque lo que se hace al elegir es distinto en cada uno.
  const [eligiendoTiempo,  setEligiendoTiempo]  = useState(null);
  // Tiempo elegido al encender, guardado hasta que se confirme el arranque.
  // Vive aquí y no en la base a propósito: si la pantalla se recarga en medio,
  // se pierde y el paso de Iniciar lo vuelve a preguntar, que es justo lo que
  // debe pasar —nadie se acuerda de qué se eligió hace media hora—.
  const [minutosPorMaquina, setMinutosPorMaquina] = useState({});
  const [encendiendo,      setEncendiendo]      = useState(null); // máquina recibiendo corriente (mig. 110)
  const [deteniendo,       setDeteniendo]       = useState(null); // máquina deteniéndose (animación)

  // Máquinas disponibles para los modales de asignar/cambiar máquina.
  const [maquinasDisp,     setMaquinasDisp]     = useState([]);
  const [loadingMaquinas,  setLoadingMaquinas]  = useState(false);
  // Todas las máquinas de la sucursal: alimentan el selector de las cargas que
  // eligieron TIPO al crear la nota y esperan su máquina física.
  const [todasMaquinas,    setTodasMaquinas]    = useState([]);

  // Modal de "Asignar Máquina": se pueden elegir varias a la vez y una lavadora
  // + una secadora se emparejan en la misma carga. El destino se elige en el
  // propio modal: una carga nueva o una existente con hueco libre. En Por
  // Encargo el empleado decide si se cobra; en Autoservicio siempre se cobra.
  const [asignarOpen,      setAsignarOpen]      = useState(false);
  const [asignarMaqSel,    setAsignarMaqSel]    = useState([]); // ids seleccionados
  // Carga a la que se suma la máquina: una carga vacía, o una que ya tiene
  // lavadora y a la que se le agrega la secadora. null = carga nueva.
  const [asignarCarga,     setAsignarCarga]     = useState(null);
  // true cuando el modal se abrió desde una carga concreta: el destino ya está
  // decidido y no se ofrece el selector "Carga nueva / Carga N".
  const [asignarCargaFija, setAsignarCargaFija] = useState(false);
  // Modo "slot": el modal se abrió desde una carga de Por Encargo a la que le
  // falta la máquina física de un tipo ya elegido ({ carga, slot, tipo }). Ahí
  // no se pregunta el cobro (la carga ya tiene su precio) ni el destino.
  const [asignarSlot,      setAsignarSlot]      = useState(null);

  // Cambiar una máquina asignada (sin iniciar) por otra del mismo tipo.
  const [cambiarMaq,       setCambiarMaq]       = useState(null); // máquina a cambiar
  const [cambiarSel,       setCambiarSel]       = useState('');

  // Terminar el secado de UNA secadora (si es la última, la nota pasa a Por Entregar)
  const [confirmTerminarMaq, setConfirmTerminarMaq] = useState(null); // máquina por cerrar

  // Tiempos de ciclo por tipo de máquina (Ajustes) y reloj para calcular,
  // por máquina, si su ciclo ya se cumplió (igual que el dashboard).
  const [tiempos, setTiempos] = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [now, setNow] = useState(() => Date.now());

  // Un cambio que mueve el total de una nota ya cobrada la devuelve a PENDIENTE
  // (el cobro anterior ya no corresponde). El aviso se muestra en el Detalle de
  // la nota, que es donde se ve el estado de pago y se vuelve a cobrar: aquí
  // solo se deja la señal con los dos importes. La nota previa va en una ref
  // para comparar sin que cargarDatos dependa del estado.
  const notaPrevia = useRef(null);

  const cargarDatos = useCallback(async () => {
    try {
      const [notaData, ajustes, maquinasData] = await Promise.all([
        api.get(`/notas/${id}`),
        api.get('/ajustes').catch(() => null),
        api.get('/maquinas').catch(() => []),
      ]);
      const previa = notaPrevia.current;
      notaPrevia.current = notaData;
      if (previa?.estado_pago === 'PAGADO' && notaData?.estado_pago === 'PENDIENTE') {
        guardarAvisoCobro(id, {
          antes: Number(previa.precio_total),
          ahora: Number(notaData.precio_total),
        });
      }
      setNota(notaData);
      if (Array.isArray(maquinasData)) setTodasMaquinas(maquinasData);
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

  // En Autoservicio TODO se cobra: no se pregunta el cobro al asignar máquina
  // (a diferencia de Por Encargo, donde una carga puede ir sin cobro).
  const esAutoservicio = nota?.tipo_servicio === 'AUTOSERVICIO';
  const esEncargo      = nota?.tipo_servicio === 'POR_ENCARGO';
  // Cómo se llama aquí cada renglón de la nota. Autoservicio y Por Encargo
  // hablan de MÁQUINAS: en los dos, un renglón es una máquina que corre —en Por
  // Encargo, la del servicio que se vendió—, y el mostrador las cuenta así.
  // Solo el servicio legado EDREDON sigue hablando de cargas.
  const porMaquinas   = esAutoservicio || esEncargo;
  const Renglon       = porMaquinas ? 'Máquina' : 'Carga';
  const renglon       = porMaquinas ? 'máquina' : 'carga';
  // Cobro atado a un corte ya cerrado: el servidor rechaza cualquier cambio que
  // mueva el total (y una caja cerrada no se reabre), así que esas acciones ni
  // se ofrecen.
  const cobroCongelado = Boolean(nota?.cobro_congelado);

  // Máquinas asignadas a la nota, sin repetir. Todas viven en sus cargas: la
  // denormalización a nivel nota (maquina_id / secadora_id) se eliminó en la
  // migración 073.
  const cargasNota = nota?.cargas ?? [];
  const maquinasNota = [...new Set(
    cargasNota.flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean)
  )];

  // Arranca UNA máquina asignada y libre (botón "Iniciar Lavado"/"Iniciar
  // Secado" por máquina): la pone en uso y la nota pasa a la fase que
  // corresponda. Las demás máquinas asignadas siguen en espera.
  // Paso previo (mig. 110): le da corriente sin arrancar el cronómetro. Se
  // dispara desde el modal, que se queda abierto mientras corre la animación y
  // vuelve convertido en el paso de iniciar.
  async function encenderMaquina(maq) {
    if (!maq) return;
    setErrorAccion('');
    setEncendiendo(maq); // arranca la animación de encendido
    try {
      // Igual que al iniciar: un mínimo para que la animación se vea aunque la
      // API responda al instante.
      await Promise.all([
        api.patch(`/notas/${id}/encender-maquina`, { maquina_id: maq.id }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      // La de cronómetro no tiene paso siguiente: ya quedó corriendo.
      if (maq.cronometro) setMaquinaModalId(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setEncendiendo(null);
    }
  }

  // Encender desde el modal. En el modelo que pregunta su tiempo, la pregunta
  // va ANTES de la corriente: así el empleado ya sabe con cuál va a correr
  // cuando se pare frente a la pantalla de la máquina a marcarlo.
  function encenderDesdeModal() {
    const maq = maqModal;
    if (!maq) return;
    if (preguntaTiempo(maq) && minutosDeMaquina(maq) == null) {
      setEligiendoTiempo({ maquina: maq, paso: 'encender' });
      return;
    }
    return encenderMaquina(maq);
  }

  // Hay modelos con varios programas que preguntan cuál correr (mig. 120).
  // Normalmente se pregunta aquí, entre el "Iniciar" y la llamada. En los que
  // llevan dos pasos ya se preguntó al encender y lo elegido se recuerda: este
  // botón solo CONFIRMA que la máquina ya está girando, que es cuando el
  // cronómetro tiene que empezar. Si la elección se perdió (recarga en medio),
  // se vuelve a preguntar antes de arrancar.
  function iniciarMaquina() {
    const maq = maqModal;
    if (!maq) return;
    if (preguntaTiempo(maq)) {
      const min = minutosDeMaquina(maq);
      if (min != null) return arrancarMaquina(maq, min);
      setEligiendoTiempo({ maquina: maq, paso: 'iniciar' });
      return;
    }
    return arrancarMaquina(maq, null);
  }

  // Lo que se hace al elegir un tiempo depende del paso del que salió el modal:
  // al encender se guarda y se da corriente; al iniciar, arranca el ciclo.
  async function elegirTiempo(min) {
    const { maquina, paso } = eligiendoTiempo ?? {};
    if (!maquina) return;
    setMinutosPorMaquina(prev => ({ ...prev, [maquina.id]: min }));
    setEligiendoTiempo(null);
    if (paso === 'encender') return encenderMaquina(maquina);
    return arrancarMaquina(maquina, min);
  }

  async function arrancarMaquina(maq, minutos) {
    if (!maq) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    setIniciando(maq); // arranca la animación de lavadora
    try {
      // Duración mínima para que la animación (agua llenándose) se alcance a
      // ver aunque la API responda al instante.
      await Promise.all([
        api.patch(`/notas/${id}/activar-pendientes`, {
          maquina_id: maq.id, ...(minutos != null && { minutos }),
        }),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
      setEligiendoTiempo(null);
      setMaquinaModalId(null);
      // El ciclo ya quedó sellado con su tiempo: recordarlo más sería arrastrar
      // la elección de esta vuelta a la siguiente.
      setMinutosPorMaquina(prev => {
        const { [maq.id]: _ya, ...resto } = prev;
        return resto;
      });
      await cargarDatos();
    } catch (err) {
      // El modal de confirmación sigue abierto detrás; ahí se muestra el error.
      setErrorAccion(err.message);
    } finally {
      setIniciando(null);
      setLoadingMaquina(false);
    }
  }

  // Desde el modal de arranque: abrir el selector para cambiar esta máquina.
  function cambiarDesdeModal() {
    const m = maqModal;
    setMaquinaModalId(null);
    iniciarCambiar(m);
  }

  // Abre el modal de arranque de una máquina, sin arrastrar el error anterior.
  function abrirModalMaquina(m) {
    setErrorAccion('');
    setMaquinaModalId(m.id);
  }

  // Asigna una máquina física a una carga de Por Encargo creada con TIPO (la
  // máquina queda asignada En Espera; se arranca con "Iniciar" de arriba).
  async function asignarTipoCarga(cargaId, slot, maquinaId) {
    if (!maquinaId) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-carga-maquina`, {
        carga_id: cargaId, slot, maquina_id: Number(maquinaId),
      });
      cerrarAsignar();
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el mismo modal de asignar, pero para el hueco de una carga de Por
  // Encargo que ya tiene TIPO elegido: solo se elige la máquina física.
  // Sin el tipo de la carga: desde el 2026-09-26 el tamaño ya no elige qué
  // máquinas se ofrecen, lo hace la propia carga (por el edredón).
  function iniciarAsignarSlot(carga, slot) {
    setErrorAccion('');
    setAsignarMaqSel([]);
    setAsignarCarga(carga);
    setAsignarCargaFija(true);
    setAsignarSlot({ carga, slot });
    setAsignarOpen(true);
  }

  // Cierra el modal de asignar y lo deja limpio para la próxima vez.
  function cerrarAsignar() {
    setAsignarOpen(false);
    setAsignarCarga(null);
    setAsignarCargaFija(false);
    setAsignarSlot(null);
  }

  // Detiene el ciclo de UNA máquina (lavadora o secadora): pasa a disponible
  // y reinicia su temporizador. Las demás máquinas de la nota no se tocan.
  async function detenerCiclo() {
    if (!confirmDetener) return;
    const maq = confirmDetener;
    setLoadingMaquina(true);
    setErrorAccion('');
    setDeteniendo(maq); // arranca la animación de detener
    try {
      // Duración mínima para que la animación se alcance a ver.
      await Promise.all([
        api.patch(`/maquinas/${maq.id}/detener-ciclo`),
        new Promise((r) => setTimeout(r, 1700)),
      ]);
      setConfirmDetener(null);
      await cargarDatos();
    } catch (err) {
      // El modal de confirmación sigue abierto detrás; ahí se muestra el error.
      setErrorAccion(err.message);
    } finally {
      setDeteniendo(null);
      setLoadingMaquina(false);
    }
  }

  // Abre el selector para asignar una máquina. Sin argumento crea un renglón
  // nuevo (máquina extra); con una carga vacía, llena esa carga.
  async function iniciarAsignar(carga = null) {
    setErrorAccion('');
    setAsignarMaqSel([]);
    // Donde se cuenta por MÁQUINAS —Autoservicio y Por Encargo— la máquina
    // extra NO se mete en un renglón que ya existe: abre uno nuevo. Una
    // secadora agregada es una máquina más de la nota, no un añadido a la
    // lavadora de al lado, y así se ve y se maneja por separado.
    // `asignarCargaFija` mira el parámetro: el selector de destino solo se
    // oculta si el modal se abrió desde un renglón concreto.
    setAsignarCarga(carga ?? (porMaquinas ? null : cargasDestino[0] ?? null));
    setAsignarCargaFija(Boolean(carga));
    setAsignarSlot(null);
    setAsignarOpen(true);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      // Excluye las que ya están asignadas a la nota (no tiene sentido volver a asignarlas).
      setMaquinasDisp((data ?? []).filter(m =>
        m.estado === 'disponible'
        && !maquinasNota.some(mid => String(mid) === String(m.id))));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquinas(false);
    }
  }

  // Alterna una máquina en la selección del modal de asignar. Al agregar a una
  // carga existente solo cabe una máquina por hueco, así que la nueva reemplaza
  // a la que estuviera elegida del mismo tipo.
  function toggleAsignarMaq(maqId) {
    const s = String(maqId);
    const esSec = (mid) => maquinasModal.some(m => String(m.id) === String(mid) && m.tipo === 'secadora');
    setAsignarMaqSel(prev => {
      if (prev.includes(s)) return prev.filter(x => x !== s);
      // Donde cada máquina es su propio renglón se elige UNA: si hacen falta
      // dos, se repite el "+ Agregar" y cada una entra por su lado. Elegir
      // lavadora y secadora de una vez las metería en el mismo renglón.
      if (porMaquinas) return [s];
      if (asignarCarga) return [...prev.filter(x => esSec(x) !== esSec(s)), s];
      return [...prev, s];
    });
  }

  // Otra vuelta de una máquina que ya terminó (Por Encargo). Vuelve a ponerla en
  // el hueco que acaba de dejar libre, así que entra como una PASADA MÁS de esa
  // misma carga: queda asignada y En Espera, y el renglón ofrece "Encender" y
  // luego "Iniciar", como cualquier máquina recién puesta.
  //
  // Corre UN SOLO ciclo, y eso no hace falta pedirlo aquí: el servidor marca la
  // pasada repetida con `ciclo_unico` (mig. 115), que es justo lo que significa
  // —relavar o secar de más sobre ropa que ya dio su vuelta—.
  //
  // Va sin cobro: lo que se cobra en Por Encargo es el servicio, así que una
  // vuelta más no mueve el total. Si la nota ya había pasado a "Por Entregar",
  // el propio endpoint la devuelve a En Espera al ver que tiene máquina otra vez.
  async function otroCiclo(carga, maq) {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-maquina`, {
        maquina_ids: [Number(maq.id)],
        cobrar: false,
        carga_id: carga.id,
      });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Cambia la carga destino y limpia la selección: los huecos disponibles
  // cambian con el destino.
  function elegirDestino(carga) {
    setErrorAccion('');
    setAsignarCarga(carga);
    setAsignarMaqSel([]);
  }

  // Asigna las máquinas elegidas: el backend crea la(s) carga(s) nueva(s) y las
  // máquinas quedan asignadas (sin iniciar). Ya no se pregunta si se cobra: en
  // Por Encargo la máquina extra SIEMPRE va sin cobro (lo que se cobra se
  // capturó al hacer la nota) y en Autoservicio se cobra su tarifa, que es lo
  // que hace la máquina en esa nota (2026-09-22).
  async function confirmarAsignar() {
    if (asignarMaqSel.length === 0) return;
    // Sin destino la máquina abre su propio renglón, que es lo normal donde se
    // cuenta por máquinas. Solo el servicio legado EDREDON necesita decir a qué
    // carga va.
    if (!asignarSlot && !asignarCarga && !porMaquinas) return;
    // Modo slot: la carga ya existe y ya está cobrada; solo se le pone máquina.
    if (asignarSlot) {
      await asignarTipoCarga(asignarSlot.carga.id, asignarSlot.slot, asignarMaqSel[0]);
      return;
    }
    const cobrar = esAutoservicio;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-maquina`, {
        maquina_ids: asignarMaqSel.map(Number),
        cobrar,
        // Sin carga destino (Autoservicio) el backend abre una carga nueva.
        ...(asignarCarga ? { carga_id: asignarCarga.id } : {}),
      });
      cerrarAsignar();
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el modal para cambiar una máquina (sin iniciar) por otra del mismo tipo.
  async function iniciarCambiar(m) {
    setErrorAccion('');
    setCambiarSel('');
    setCambiarMaq(m);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      const esSecadora = m.tipo === 'secadora';
      // Del mismo tipo, disponibles, y que no estén ya asignadas a la nota.
      setMaquinasDisp((data ?? []).filter(x =>
        x.estado === 'disponible'
        && (esSecadora ? x.tipo === 'secadora' : x.tipo !== 'secadora')
        && !maquinasNota.some(mid => String(mid) === String(x.id))));
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquinas(false);
    }
  }

  // Cambia la máquina elegida por la nueva (el backend re-tarifa la carga).
  async function confirmarCambiar() {
    if (!cambiarMaq || !cambiarSel) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/cambiar-maquina`, {
        maquina_actual_id: cambiarMaq.id,
        maquina_nueva_id: Number(cambiarSel),
      });
      setCambiarMaq(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Cierra la carga de una máquina que ya cumplió su ciclo: el backend la
  // libera y, si a la nota no le queda nada, la pasa a "Por Entregar". La
  // secadora termina su secado; la lavadora termina el lavado sin pasar a
  // secado (en Por Encargo la secadora se asigna y arranca aparte).
  async function terminarCicloMaquina() {
    const maq = confirmTerminarMaq;
    if (!maq) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await (maq.tipo === 'secadora'
        ? api.patch(`/notas/${id}/terminar-secado`, { secadora_id: Number(maq.id) })
        : api.patch(`/notas/${id}/terminar-lavado-final`, { lavadora_id: Number(maq.id) }));
      setConfirmTerminarMaq(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmTerminarMaq(null);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el modal con el catálogo de productos activos de la sucursal.
  async function iniciarAgregarProducto() {
    setErrorAccion('');
    setAgregarProdOpen(true);
    setLoadingCatalogo(true);
    try {
      const data = await api.get('/productos');
      setCatalogoProd(data ?? []);
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingCatalogo(false);
    }
  }

  // Suma el producto a la nota, de uno en uno: entra con cantidad 1 y desde el
  // renglón se sube con el +. El precio y la unidad los pone el servidor según
  // el servicio (botella en Autoservicio, medida en Por Encargo), y el producto
  // queda apartado del inventario.
  async function agregarProductoDeLista(productoId) {
    setLoadingProducto('nuevo');
    setErrorAccion('');
    try {
      await api.post(`/notas/${id}/productos`, {
        producto_id: Number(productoId), cantidad: 1,
      });
      setAgregarProdOpen(false);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Sube o baja la cantidad de un producto que la nota ya lleva. Va con la
  // cantidad COMPLETA, no con un delta: si dos empleados tocan los botones a la
  // vez, la nota acaba en el número que se ve y no en la suma de los dos.
  async function cambiarCantidadProducto(productoId, cantidad) {
    if (cantidad < 1) return;
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/productos/${productoId}`, { cantidad });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Quita un producto mal capturado en la nota. Es de admin: el producto vuelve
  // al inventario y el total baja.
  async function eliminarProducto(productoId) {
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}/productos/${productoId}`);
      setConfirmQuitarProd(null);
      await cargarDatos();
    } catch (err) {
      // El modal se queda abierto con el motivo dentro: el aviso de la página
      // vive arriba del todo y en esta pantalla larga queda fuera de vista.
      setErrorAccion(err.message);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Quita una carga que el cliente ya no va a usar (trajo menos ropa de la
  // prevista). Solo se ofrece en las cargas sin máquina: las que ya lavaron son
  // historial y el servidor las rechaza.
  // Devuelve si se pudo: quien la llama cierra su modal solo cuando salió bien,
  // para que un rechazo se lea ahí mismo y no en un aviso fuera de pantalla.
  async function quitarCarga(carga) {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}/cargas/${carga.id}`);
      await cargarDatos();
      return true;
    } catch (err) {
      setErrorAccion(err.message);
      return false;
    } finally {
      setLoadingMaquina(false);
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
  // mostrarlas bajo su encabezado "Carga N". Se incluyen también las máquinas ya
  // desvinculadas (usada): la que sigue viva muestra su estado (En espera / En
  // uso); la que ya cumplió su parte se queda como "terminado" (verde), sin botones.
  const cargasMaquinas = (() => {
    // Asignar no aparta: varias notas pueden tener la misma máquina asignada y
    // se la queda la primera que le da a Iniciar. Si otra se adelantó, aquí se
    // detecta para avisar y ofrecer el cambio en vez del botón de arranque.
    const usadaPorOtra = (maquinaId) => {
      const m = todasMaquinas.find(x => String(x.id) === String(maquinaId));
      if (!m || m.estado !== 'en_uso' || !m.en_uso_nota_id) return null;
      return String(m.en_uso_nota_id) === String(id) ? null : (m.en_uso_folio ?? 'otra nota');
    };
    // Una línea POR PASADA (mig. 114): la carga que se relavó lista su lavadora
    // dos veces aunque sea la misma máquina. Solo la pasada marcada `actual`
    // está viva —es la que puede encenderse, iniciarse o cerrarse—; las
    // anteriores son historial y van sin botones.
    return cargasNota
      .map(c => ({
        id: c.id,
        orden: c.orden,
        maquinas: (c.maquinas_usadas ?? []).map(u => {
          const esLav = u.slot === 'lavadora';
          return {
            // Sin `maquina_id` la máquina se borró del catálogo: queda el
            // nombre congelado, pero ya no hay nada que accionar.
            id: u.maquina_id,
            // Identidad de la FILA, no de la máquina: con la misma lavadora dos
            // veces, el id de máquina ya no distingue una pasada de la otra.
            pasadaId: u.id,
            actual: Boolean(u.actual),
            // De qué hueco es la pasada: hace falta para saber si ese hueco
            // quedó libre y se le puede dar otra vuelta a la misma máquina.
            slot: u.slot,
            nombre: u.nombre,
            tipo: u.tipo,
            // Los tiempos que ofrece su modelo: deciden si al iniciarla se
            // pregunta con cuál correr (mig. 120).
            modelo_tiempos: u.modelo_tiempos ?? null,
            // Su marca puede declarar que la máquina ARRANCA SOLA al recibir
            // corriente (mig. 122): entonces encender e iniciar son lo mismo y
            // el paso de "Encender máquina" sobra.
            arrancaSola: Boolean(u.marca_opciones?.arranca_sola),
            // Cronómetro (todas menos el modelo que pregunta su tiempo,
            // 2026-10-02): encenderla ya arranca su carga, no hay "Iniciar" y
            // se finaliza a mano cuando termine.
            cronometro: Boolean(u.cronometro),
            ...(esLav ? {} : { tamano: u.tamano }),
            // La pasada viva muestra el estado real de su máquina; una ya
            // cerrada cumplió su parte (verde).
            estado: u.actual
              ? (esLav ? c.lavadora_estado : c.secadora_estado)
              : 'terminado',
            en_uso_desde: u.actual ? (esLav ? c.lavadora_en_uso_desde : c.secadora_en_uso_desde) : null,
            ciclo_minutos: u.actual ? (esLav ? c.lavadora_ciclo_minutos : c.secadora_ciclo_minutos) : null,
            esperandoArranque: Boolean(u.actual
              && (esLav ? c.lavadora_esperando_arranque : c.secadora_esperando_arranque)),
            tomadaPor: u.actual && u.maquina_id ? usadaPorOtra(u.maquina_id) : null,
            // En Autoservicio, una lavadora cuya carga todavía debe secar no
            // cierra nada: el paso siguiente es pasar la ropa a la secadora, y
            // eso se hace desde la tarjeta de Máquinas, que pide elegirla. En
            // Por Encargo la secadora va aparte, así que la lavadora sí cierra
            // su carga aquí (2026-09-22).
            encadenaSecado: esLav && esAutoservicio
              && Boolean(c.secadora_tipo_previsto)
              && !c.secadora_id && !c.secadora_usada_id,
          };
        }),
      }))
      .filter(g => g.maquinas.length > 0);
  })();

  // Lista plana (para conteo del encabezado y validaciones de acciones a nivel nota).
  const maquinasAsignadas = cargasMaquinas.flatMap(g => g.maquinas);

  // Máquina del modal de arranque, tomada de la lista VIVA: por eso el modal
  // pasa solo de "Encender máquina" a "Iniciar Lavado" en cuanto la máquina
  // queda encendida, sin cerrarse ni volver a abrirse.
  // Se busca la pasada VIVA: si la carga repitió máquina, la lista trae la
  // misma id dos veces y la primera es historial, sin nada que accionar.
  const maqModal = maquinaModalId == null
    ? null
    : maquinasAsignadas.find(x => x.actual && String(x.id) === String(maquinaModalId)) ?? null;
  // La que arranca sola no tiene primer paso: darle corriente ES arrancarla,
  // así que el modal entra directo al de iniciar (mig. 122).
  //
  // EXCEPCIÓN: el modelo que pregunta su tiempo (la Speed Queen Sec49) sí
  // necesita los dos pasos aunque su marca arranque sola. El tiempo no se
  // marca en la app, se marca en la PANTALLA de la máquina —cada toque sube de
  // 10 en 10— y después se le da a su botón de iniciar. Si la app arrancara el
  // cronómetro al dar corriente, contaría los 20 minutos mientras el aparato
  // todavía va en 10 (2026-09-29).
  const preguntaSuTiempo = preguntaTiempo(maqModal);
  // La de cronómetro siempre entra por "Encender": ese paso ya la arranca.
  const pasoModal = !maqModal?.cronometro
    && (maqModal?.esperandoArranque || (maqModal?.arrancaSola && !preguntaSuTiempo))
    ? 'iniciar' : 'encender';
  // Lo que se eligió al encender esta máquina, si sigue vivo.
  const minutosDeMaquina = (maq) => (maq ? minutosPorMaquina[maq.id] ?? null : null);

  // Cargas que se eligieron al hacer la nota pero se quedaron sin máquina (ni
  // asignada ni ya usada). Se muestran para poder asignarles una rápidamente.
  //
  // En POR ENCARGO no hay ninguna: lo que la nota captura son SERVICIOS —lo que
  // se le cobra al cliente— y las máquinas son de esta pantalla, independientes
  // de lo que se vendió. Tres servicios no son tres máquinas por llenar: el
  // mostrador mete la ropa en las máquinas que le acomoden y las agrega aquí.
  const notaCerrada = ['FINALIZADA', 'CANCELADA'].includes(nota?.estado);
  const cargasVacias = notaCerrada || esEncargo ? [] : cargasNota.filter(c =>
    !c.lavadora_id && !c.secadora_id && !c.lavadora_usada_id && !c.secadora_usada_id
    // Las cargas de Por Encargo con TIPO previsto se asignan en su sección propia.
    && !c.lavadora_tipo_previsto && !c.secadora_tipo_previsto
  );

  // Huecos de una carga: lo que tiene LIBRE ahora mismo. Haber pasado ya por
  // una lavadora (o por una secadora) no cierra el hueco — la misma ropa puede
  // necesitar otro lavado o más secado, y eso va en su carga, no en una nueva
  // (2026-09-22). Lo único que ocupa el hueco es una máquina puesta y todavía
  // sin liberar. El de lavadora tampoco se ofrece si la carga tiene un TIPO
  // previsto pendiente: ese se asigna en su sección propia, con el tipo que se
  // eligió al hacer la nota.
  // Un TIPO previsto que todavía no se asignó tiene su propio renglón
  // ("Asignar Lav."), así que ese hueco no se ofrece además en "+ Agregar".
  // Una vez asignado —aunque la máquina ya se haya liberado— deja de estar
  // pendiente y el hueco vuelve a quedar disponible aquí.
  const previstoPendiente = (c, slot) => slot === 'lavadora'
    ? Boolean(c.lavadora_tipo_previsto) && !c.lavadora_id && !c.lavadora_usada_id
    : Boolean(c.secadora_tipo_previsto) && !c.secadora_id && !c.secadora_usada_id;
  const huecosDeCarga = (c) => ({
    lavadora: Boolean(c) && !c.lavadora_id && !previstoPendiente(c, 'lavadora'),
    secadora: Boolean(c) && !c.secadora_id && !previstoPendiente(c, 'secadora'),
  });

  // ¿Esta máquina (su carga) se puede quitar de la nota? Es para deshacer un
  // agregado por error: solo mientras NUNCA haya arrancado —después es
  // historial de un lavado que sí ocurrió—, nunca la única que le queda a la
  // nota (para eso se cancela) y no con el cobro congelado en un corte cerrado.
  // El servidor aplica las mismas tres reglas; esto solo evita ofrecer un botón
  // que iba a fallar.
  const puedeQuitarCarga = (c) =>
    Boolean(nota) && !notaCerrada && !cobroCongelado
    && cargasNota.length > 1
    && !c.lavadora_iniciada_at && !c.secadora_iniciada_at;

  // Lo que esta carga le cobra a la nota: es lo que deja de cobrarse al quitarla.
  //
  // En Por Encargo es el PRECIO DEL SERVICIO congelado en la carga (`tope_carga`,
  // mig. 096), que ya lleva dentro su material: sumar máquinas y productos daría
  // los $25 del jabón y la bolsa en vez de los $150 que se cobran. Lo único que
  // va encima son los productos de marca y el ajuste. Sin tope —Autoservicio, o
  // una máquina que se agregó aquí— se suma lo que de verdad cobra.
  const costoDeCarga = (c) => {
    const prods = (c?.productos ?? []).reduce((a, p) => a + Number(p.subtotal || 0), 0);
    if (c?.tope_carga != null) {
      const marca = (c?.productos ?? [])
        .filter(seVendePorUnidad)
        .reduce((a, p) => a + Number(p.subtotal || 0), 0);
      return Number(c.tope_carga) + marca + Number(c?.ajuste || 0);
    }
    return Number(c?.precio_lavadora || 0) + Number(c?.precio_secadora || 0)
      + Number(c?.ajuste || 0) + prods;
  };

  // Cargas a las que se les puede sumar una máquina en vez de abrir una carga
  // nueva (p. ej. la Carga 1 solo tiene lavadora y se le agrega la secadora).
  const cargasDestino = notaCerrada ? [] : cargasNota.filter(c => {
    const h = huecosDeCarga(c);
    return h.lavadora || h.secadora;
  });

  // Carga destino del modal, siempre en su versión recién cargada.
  const cargaDestino = asignarCarga
    ? (cargasNota.find(c => String(c.id) === String(asignarCarga.id)) ?? asignarCarga)
    : null;
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

  // ¿La de cronómetro ya pasó su tope? Es su `ciclo_minutos` sellado al
  // encender, contado desde que arrancó: el mismo cálculo de la tarjeta.
  const topeAlcanzado = (m) => Boolean(m.cronometro && m.en_uso_desde && m.ciclo_minutos)
    && now - new Date(m.en_uso_desde).getTime() >= Number(m.ciclo_minutos) * 60000;

  // Lavadora y secadora se asignan igual: en cuanto la nota existe. La
  // secadora esperaba a que terminara el lavado para no quedarse con una
  // máquina parada, pero asignar no la aparta —se la queda quien le dé a
  // Iniciar primero (ver maquinasParaSlot)—, así que la espera solo escondía
  // trabajo que el mostrador quiere dejar listo de una vez (2026-09-22).
  const slotsPorAsignar = notaCerrada ? [] : cargasNota.flatMap(c => {
    const out = [];
    if (c.lavadora_tipo_previsto && !c.lavadora_id && !c.lavadora_usada_id) {
      out.push({ carga: c, slot: 'lavadora', tipo: c.lavadora_tipo_previsto });
    }
    if (c.secadora_tipo_previsto && !c.secadora_id && !c.secadora_usada_id) {
      out.push({ carga: c, slot: 'secadora', tipo: c.secadora_tipo_previsto });
    }
    return out;
  });
  // Todo lo de una carga va junto y bajo UN solo título: las máquinas que ya
  // tiene puestas, los huecos que le faltan por asignar y el aviso de que no
  // tiene ninguna. La carga es la unidad que el mostrador entiende ("la Carga 1
  // lleva lavadora y secadora"), y antes eran tres listas independientes: una
  // carga con la lavadora puesta y la secadora pendiente salía dos veces, cada
  // vez con su propio "Carga 1" (2026-09-22).
  const bloquesCarga = cargasNota
    .map(c => ({
      carga: c,
      maquinas: cargasMaquinas.find(g => String(g.id) === String(c.id))?.maquinas ?? [],
      slots: slotsPorAsignar.filter(s => String(s.carga.id) === String(c.id)),
      vacia: cargasVacias.some(v => String(v.id) === String(c.id)),
    }))
    .filter(b => b.maquinas.length > 0 || b.slots.length > 0 || b.vacia);

  // Con qué número se enseña un renglón. En Por Encargo se cuenta por su lugar
  // en ESTA pantalla: el `orden` de la carga cuenta también los servicios
  // vendidos —que aquí no salen, porque las máquinas son independientes de lo
  // que se cobró—, así que la primera máquina de la nota aparecía como
  // "Máquina 4". En los demás servicios el orden ya es el del renglón.
  const numeroDeCarga = (c) => {
    if (!esEncargo) return c?.orden;
    const i = bloquesCarga.findIndex(b => String(b.carga.id) === String(c?.id));
    return i >= 0 ? i + 1 : c?.orden;
  };

  // Máquinas disponibles que coinciden con un slot (lavadora/secadora) y su tipo.
  // Se ofrecen todas las máquinas libres del tipo. Que otra nota ya tenga
  // asignada una de ellas no la descarta: asignar no aparta, se la queda quien
  // le dé a Iniciar primero. Eso sí, se avisa en la propia opción.
  const maquinasParaSlot = (slot, carga) => todasMaquinas.filter(m => {
    if (m.estado !== 'disponible') return false;
    if (slot === 'lavadora') {
      if (m.tipo === 'secadora') return false;
      // Se ofrecen TODAS las lavadoras libres, sin mirar el tamaño que eligió
      // la nota (2026-09-26). En el mostrador se mete la ropa en la que esté
      // desocupada, y el precio no depende de eso: en Por Encargo se cobra el
      // tope de la carga, congelado al crearla, y en Autoservicio se tarifa la
      // máquina que de verdad se asigne. Filtrar por tamaño solo dejaba a la
      // carga esperando una mediana con dos jumbos libres al lado.
      //
      // La única excepción es física y no de tarifa: un edredón no cabe en una
      // mediana. El backend la vuelve a comprobar al asignar.
      return esEdredonCarga(carga) ? m.tipo === 'lavadora_jumbo' : true;
    }
    // La secadora es de un solo tamaño: cualquier secadora disponible sirve.
    return m.tipo === 'secadora';
  });

  // Qué ofrece el modal de asignar. En modo slot el hueco es el del slot que se
  // vino a llenar y las máquinas son las del tipo que pide esa carga; si no,
  // manda el destino elegido (carga nueva = caben las dos).
  const huecosAsignar = asignarSlot
    ? { lavadora: asignarSlot.slot === 'lavadora', secadora: asignarSlot.slot === 'secadora' }
    : cargaDestino ? huecosDeCarga(cargaDestino) : { lavadora: true, secadora: true };
  const maquinasModal = asignarSlot
    ? maquinasParaSlot(asignarSlot.slot, asignarSlot.carga)
    // Con carga destino vale la misma regla física que en el modo slot: un
    // edredón no cabe en una mediana. Importa desde que Por Encargo dejó de
    // elegir tipo de máquina al hacer la nota —sus cargas llegan aquí sin hueco
    // previsto y entran por este camino—; el servidor lo vuelve a comprobar.
    : cargaDestino && esEdredonCarga(cargaDestino)
      ? maquinasDisp.filter(m => m.tipo === 'secadora' || m.tipo === 'lavadora_jumbo')
      : maquinasDisp;
  // La que esta carga acabó de usar en ese hueco (mig. 114). Es la candidata
  // natural para la vuelta siguiente —relavar, secar de más—: la ropa ya está
  // adentro y la máquina acaba de quedar libre. Se sugiere de primera en la
  // lista, no se preselecciona: asignar sale de un solo toque y no se deshace
  // sin volver a Salidas.
  const ultimaUsadaEnSlot = (slot) => {
    const usadas = (cargaDestino?.maquinas_usadas ?? []).filter(u => u.slot === slot);
    return usadas.length ? usadas[usadas.length - 1].maquina_id : null;
  };
  // Pone esa máquina al principio sin alterar el orden de las demás.
  const sugiriendoPrimero = (lista, maquinaId) => {
    if (!maquinaId) return lista;
    const i = lista.findIndex(m => String(m.id) === String(maquinaId));
    return i <= 0 ? lista : [lista[i], ...lista.slice(0, i), ...lista.slice(i + 1)];
  };
  const idUltimaLav = ultimaUsadaEnSlot('lavadora');
  const idUltimaSec = ultimaUsadaEnSlot('secadora');

  // Solo se ofrecen las máquinas que caben en el destino elegido.
  const lavadorasDisp = huecosAsignar.lavadora
    ? sugiriendoPrimero(maquinasModal.filter(m => m.tipo !== 'secadora'), idUltimaLav) : [];
  const secadorasDisp = huecosAsignar.secadora
    ? sugiriendoPrimero(maquinasModal.filter(m => m.tipo === 'secadora'), idUltimaSec) : [];

  // ¿Por qué la nota NO pasa a "Por Entregar" al cerrar esta máquina? Devuelve
  // el motivo ya redactado, o null si al cerrarla la nota sí queda lista.
  //
  // Los tres casos van en una sola función porque el ORDEN importa. Una máquina
  // que otra nota se ganó al iniciar se ve "en uso" —el estado es de la
  // máquina, no de la carga—, y contarla entre las que están corriendo daba un
  // veredicto correcto con una explicación falsa: "sus demás cargas todavía
  // están en máquina", cuando esa carga no ha arrancado nunca (2026-09-22).
  const motivoEnProceso = (maq) => {
    // Las demás máquinas de la nota. Se comparan por máquina y no por pasada
    // para que la carga que repitió la misma lavadora no se cuente a sí misma.
    const otras = maquinasAsignadas.filter(m => String(m.id) !== String(maq.id));
    const tomada = otras.find(m => m.actual && m.tomadaPor);
    if (tomada) {
      return `: la nota ${tomada.tomadaPor} se quedó con ${tomada.nombre}, así que esa carga todavía no arranca.`;
    }
    if (otras.some(m => m.estado === 'en_uso' && !m.tomadaPor)) {
      return ': sus demás cargas todavía están en máquina.';
    }
    // Trabajo que le queda a la nota aparte de lo que está corriendo: máquinas
    // que la carga compró y aún no tiene puestas, y máquinas ya puestas que
    // nadie ha arrancado.
    const pendiente = slotsPorAsignar.length > 0
      || otras.some(m => m.actual && m.estado !== 'terminado'
           // Corriendo = en uso y con el cronómetro andando. Encendida esperando
           // arranque, o detenida a media vuelta, es trabajo que sigue ahí.
           && (m.estado !== 'en_uso' || m.esperandoArranque));
    return pendiente ? ': le queda otra máquina por asignar o por arrancar.' : null;
  };
  const motivoTerminar = confirmTerminarMaq ? motivoEnProceso(confirmTerminarMaq) : null;
  // En qué estado queda la nota cuando esta máquina era lo último: el
  // autoservicio YA COBRADO se cierra solo (el cliente se lleva su ropa), y el
  // que todavía debe espera ahí su cobro — "Por Cobrar" en Autoservicio, "Por
  // Entregar" en un encargo. Es la regla de `estadoAlTerminarCargas` en el
  // servidor; aquí solo se usa para no prometer un estado que no va a pasar.
  const estadoAlCerrar = esAutoservicio && nota?.estado_pago === 'PAGADO'
    ? 'Finalizada'
    : etiquetaEstadoLista(nota?.tipo_servicio);

  // En el orden en que se agregaron —el que manda el servidor— así el producto
  // recién puesto aparece ABAJO, donde lo dejó quien lo agregó. Ordenarlos por
  // tipo lo mandaba al medio de la lista y había que buscarlo.
  const productosNota  = nota?.productos ?? [];
  const totalProductosNota = productosNota.reduce((a, x) => a + Number(x.subtotal || 0), 0);
  // Una nota cobrada y cerrada ya no acepta productos, y con el cobro congelado
  // en un corte cerrado no se toca lo que cuesta.
  const puedeTocarProductos = Boolean(nota) && !cobroCongelado
    && !['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(nota.estado);

  // Lo que queda de un producto del catálogo, en las piezas con las que se
  // sirve: medidas el granel, unidades la marca y piezas las bolsas. El stock
  // vive en medidas, así que los que se venden por envase se convierten.
  const porMedida = (p) => p.clase !== 'bolsa' && p.tipo_liquido === 'granel' && !esPolvo(p) && esEncargo;
  const existenciaProducto = (p) => {
    const medidas = Number(p.stock_disponible ?? p.stock_actual) || 0;
    if (p.clase === 'bolsa' || porMedida(p)) return medidas;
    const tpb = Number(p.medidas_por_botella) || 0;
    return tpb > 0 ? Math.floor(medidas / tpb) : medidas;
  };
  // Precio y existencia en una línea, como en el alta.
  const detalleProducto = (p) => {
    const disp = existenciaProducto(p);
    const [uno, varios] = p.clase === 'bolsa' ? ['bolsa', 'bolsas']
      : porMedida(p) ? ['medida', 'medidas']
      : seVendePorUnidad(p) ? ['unidad', 'unidades']
      : ['botella', 'botellas'];
    const precio = porMedida(p) || p.clase === 'bolsa'
      ? Number(p.precio_unitario) || 0
      : Number(p.precio_botella) || 0;
    return `${fmtMonto(precio)}/${uno} · ${plural(disp, uno, varios)}`;
  };

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

      {/* El cobro de esta nota quedó en un corte que ya se cerró: nada que
          mueva su total se puede hacer, así que se dice de una vez en vez de
          dejar que el empleado lo descubra al confirmar (2026-09-22). */}
      {cobroCongelado && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3">
          Esta nota se cobró en un corte que ya se cerró, así que <span className="font-medium">no se
          puede cambiar lo que cuesta</span>: no se agregan ni se quitan máquinas ni productos. Lo que
          falte se cobra en una nota nueva; lo que haya que devolver va como salida de caja.
        </div>
      )}

      {/* Sección 1 — Máquinas */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Máquinas</h2>
          {/* Asignar una máquina EXTRA (una que no se vendió en la nota):
              disponible desde el inicio, salvo en notas cerradas.
              En Por Encargo va a una carga que ya existe, así que hace falta
              alguna con hueco libre. En Autoservicio vuelve a ofrecerse
              (2026-09-25): ya no se cobra por adelantado, y ahí la máquina de
              más entra como una MÁQUINA NUEVA de la nota —su propio renglón,
              con su tarifa—, igual que se capturan en la nota. Las máquinas que
              la nota SÍ compró se asignan con el botón "Asignar" de cada carga.
          */}
          {nota && !cobroCongelado
            && !['FINALIZADA', 'CANCELADA'].includes(nota.estado)
            && (esAutoservicio || cargasDestino.length > 0) && (
            <button
              onClick={() => iniciarAsignar()}
              disabled={loadingMaquina}
              className="flex items-center gap-1 text-xs font-medium text-blue hover:underline disabled:opacity-60"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Agregar
            </button>
          )}
        </div>
        <div className="px-4 py-4 space-y-4">
          {bloquesCarga.length === 0 && (
            // Ni máquinas puestas, ni huecos por asignar, ni cargas vacías:
            // ahí sí no hay nada que enseñar.
            <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
          )}

          {bloquesCarga.map(({ carga, maquinas, slots, vacia }) => (
            <div key={carga.id} className="space-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-gray-100 [&:not(:first-child)]:pt-4">
              {carga.orden != null && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-gray-500">
                    {/* Cada renglón es una máquina, y así se llama también en la
                        captura y en el ticket (2026-09-25). */}
                    {/* Sin el tamaño de la carga al lado: el tamaño es del
                        bulto de ropa, no de la máquina, y aquí se administran
                        máquinas. Cualquiera sirve para cualquier servicio —la
                        única excepción es física, el edredón en la jumbo—, así
                        que ponerlo aquí sugería una atadura que no existe. */}
                    {Renglon} {numeroDeCarga(carga)}
                  </p>
                  {/* Quitar la que se agregó de más. Solo mientras no haya
                      arrancado (después es historial), nunca la única que le
                      queda a la nota, y no con el cobro congelado. */}
                  {puedeQuitarCarga(carga) && (
                    <button
                      onClick={() => setConfirmQuitarCarga(carga)}
                      disabled={loadingMaquina}
                      className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40 flex-shrink-0"
                      title="Quitar de la nota"
                      aria-label={`Quitar ${renglon} ${numeroDeCarga(carga)} de la nota`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              {maquinas.map((m, i) => {
                // Lavadora que ya cumplió su ciclo (terminó el lavado): se
                // muestra en verde y sin botón; el secado se inicia aparte
                // desde la secadora de la carga.
                // La de cronómetro no "cumple" nada: corre hasta que la finalizan.
                const lavadoTerminado = m.estado === 'en_uso' && m.tipo !== 'secadora'
                  && !m.cronometro && cicloCumplido(m);
                // ¿Se le puede dar otra vuelta a ESTA máquina? Solo en Por
                // Encargo, sobre la ÚLTIMA pasada de su hueco —las anteriores
                // son historial—, con el hueco libre (ya se soltó al terminar),
                // la máquina todavía en el catálogo y sin que otra nota la haya
                // tomado mientras tanto.
                const ultimaDelSlot = maquinas.filter(x => x.slot === m.slot).at(-1);
                const puedeOtroCiclo = esEncargo && !notaCerrada
                  && m.estado === 'terminado'
                  && String(ultimaDelSlot?.pasadaId) === String(m.pasadaId)
                  && huecosDeCarga(carga)[m.slot]
                  && Boolean(m.id)
                  && todasMaquinas.some(x => String(x.id) === String(m.id) && x.estado === 'disponible');
                const cfg = lavadoTerminado ? BADGE_MAQUINA_ESTADO.terminado : BADGE_MAQUINA_ESTADO[m.estado];
                // "Marca · Tamaño" (LG · Mediana). La pasada guarda el nombre y
                // el tipo, no la marca: esa se lee del catálogo vivo. Si la
                // máquina ya no está en él, queda solo el tamaño.
                const fisica = todasMaquinas.find(x => String(x.id) === String(m.id));
                const tipoLabel = marcaYTamano({
                  ...m, marca: fisica?.marca, tamano: fisica?.tamano ?? m.tamano,
                });
                return (
                  <div key={m.pasadaId ?? i} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {/* Estado: solo el punto de color */}
                      {cfg && (
                        <span
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' && !lavadoTerminado ? 'animate-pulse' : ''}`}
                          title={cfg.label}
                        />
                      )}
                      <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                      {tipoLabel && (
                        <span className="text-xs text-gray-500">— {tipoLabel}</span>
                      )}
                      {m.tomadaPor && (
                        <span className="text-xs font-medium text-amber-700 basis-full">
                          La está usando la nota {m.tomadaPor}. Cámbiala por otra para poder iniciar.
                        </span>
                      )}
                      {m.esperandoArranque && (
                        <span className="text-xs font-medium text-green-700 basis-full">
                          Encendida. Carga la ropa, arráncala y dale a Iniciar.
                        </span>
                      )}
                      {m.cronometro && m.estado === 'en_uso' && !m.tomadaPor && (
                        // Mismo aviso que la tarjeta de Máquinas: pasado su
                        // tope, el corte ya le quitó la luz y falta finalizarla.
                        topeAlcanzado(m) ? (
                          <span className="text-xs font-medium text-red-600 basis-full">
                            Llegó al tope y se le cortó la luz.
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-green-700 basis-full">
                            Encendida. Arráncala con su botón y finalízala cuando termine.
                          </span>
                        )
                      )}
                    </div>
                    {/* Otra nota se la ganó al iniciar: aquí no hay nada que
                        arrancar ni detener, solo cambiarla por una libre. */}
                    {m.tomadaPor ? (
                      <button
                        onClick={() => iniciarCambiar(m)}
                        disabled={loadingMaquina}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Cambiar máquina
                      </button>
                    ) : (<>
                    {/* Acción por máquina, en dos pasos (mig. 110). Primero
                        "Encender máquina", que solo le da corriente para poder
                        cargar la ropa y apretar su botón físico; después
                        "Iniciar", que arranca el cronómetro cuando el lavado
                        ya empezó de verdad. Cuando los dos eran uno, el rato
                        de cargar se le descontaba al ciclo.
                        Los dos botones abren el MISMO modal: el paso que
                        muestra lo decide el estado de la máquina, así que la
                        que ya está encendida entra directo al de iniciar. */}
                    {m.estado === 'disponible' && (
                      <button
                        onClick={() => abrirModalMaquina(m)}
                        disabled={loadingMaquina || Boolean(encendiendo)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {/* La que arranca sola no pasa por "Encender": se le da
                            corriente y ya está lavando (mig. 122). */}
                        {m.arrancaSola && !m.cronometro
                          ? (m.tipo === 'secadora' ? 'Iniciar secado' : 'Iniciar lavado')
                          : 'Encender máquina'}
                      </button>
                    )}
                    {m.esperandoArranque && (
                      <button
                        onClick={() => abrirModalMaquina(m)}
                        disabled={loadingMaquina}
                        className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {m.tipo === 'secadora' ? 'Iniciar Secado' : 'Iniciar Lavado'}
                      </button>
                    )}
                    {m.estado === 'en_uso' && !m.esperandoArranque && (
                      (m.cronometro || cicloCumplido(m)) ? (
                        // Ya cumplió su ciclo: cerrar la carga de esa máquina.
                        // La única que no lo ofrece es la lavadora que encadena
                        // secado (Autoservicio): ahí el paso es pasar la ropa a
                        // la secadora, desde la tarjeta de Máquinas.
                        !m.encadenaSecado ? (
                          <button
                            onClick={() => setConfirmTerminarMaq(m)}
                            disabled={loadingMaquina}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            Finalizar Carga
                          </button>
                        ) : null
                      ) : (
                        // Solo un admin puede detener una LAVADORA; la secadora
                        // la puede detener cualquier usuario. Oculto por ahora
                        // (ver la bandera arriba).
                        MOSTRAR_DETENER_CICLO && (m.tipo === 'secadora' || esAdmin) && (
                          <button
                            onClick={() => setConfirmDetener(m)}
                            disabled={loadingMaquina}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            {m.tipo === 'secadora' ? 'Detener Secado' : 'Detener Lavado'}
                          </button>
                        )
                      )
                    )}
                    {/* estado "terminado": ya cumplió su parte. En Por Encargo
                        se le puede dar una vuelta más —la ropa salió sucia, hay
                        que relavarla o secarla otro rato—, y esa vuelta corre un
                        solo ciclo. En los demás casos el renglón se queda sin
                        acciones, solo con el punto verde. */}
                    {puedeOtroCiclo && (
                      <button
                        onClick={() => otroCiclo(carga, m)}
                        disabled={loadingMaquina}
                        className="px-4 py-2 border border-gray-300 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
                      >
                        Otro ciclo
                      </button>
                    )}
                    </>)}
                  </div>
                );
              })}

              {/* Por Encargo: huecos con TIPO elegido y sin máquina física. Se
                  asigna eligiendo una máquina disponible del tipo que toca. */}
              {slots.length > 0 && (<>
                {/* Lavadora y secadora son dos renglones casi idénticos con el
                    mismo botón azul, y se pulsan con el dedo: los separa el aire
                    entre ellos y el botón diciendo QUÉ asigna, para no darle a la
                    máquina equivocada. La línea se reserva para separar cargas
                    (la pinta el contenedor de arriba), que es la división que
                    cuenta. */}
                <div>
                  {slots.map(({ slot, carga: cargaSlot }) => {
                    const opciones = maquinasParaSlot(slot, cargaSlot);
                    // El tamaño solo se nombra donde todavía manda: el edredón.
                    const queFalta = slot !== 'lavadora' ? 'secadoras'
                      : esEdredonCarga(cargaSlot) ? 'lavadoras Jumbo'
                      : 'lavadoras';
                    const esLavadora = slot === 'lavadora';
                    return (
                      <div key={slot} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        {/* Solo "Lavadora": el tamaño dejó de decidir cuál se
                            puede asignar (2026-09-26), así que nombrarlo aquí
                            sobraba. Donde sigue mandando —el edredón— lo dice
                            el aviso de al lado. */}
                        <span className="text-sm font-medium text-gray-700">
                          {esLavadora ? 'Lavadora' : 'Secadora'}
                        </span>
                        {opciones.length === 0 ? (
                          <span className="text-sm text-red-600">No hay {queFalta} disponibles</span>
                        ) : (
                          // Abre el mismo modal que "+ Agregar", ya fijado a
                          // esta carga y a las máquinas del tipo que le toca. El
                          // botón dice QUÉ asigna —abreviado, para que quepa
                          // junto a su etiqueta hasta en pantallas de 320px— y
                          // así no se confunde con el renglón de al lado.
                          <button
                            onClick={() => iniciarAsignarSlot(carga, slot)}
                            disabled={loadingMaquina}
                            className="w-full min-[360px]:w-auto px-4 py-3 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                          >
                            {esLavadora ? 'Asignar Lav.' : 'Asignar Sec.'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>)}

              {/* La carga se eligió al hacer la nota y se quedó sin máquina:
                  se muestra para asignarle una rápidamente. */}
              {vacia && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-gray-400 italic">Sin máquina asignada</span>
                  <div className="flex items-center gap-2">
                    {/* Quitarla va en el encabezado del bloque, junto a su
                        nombre: desde ahí se puede quitar cualquiera que no haya
                        arrancado, tenga máquina o no (2026-09-25). */}
                    <button
                      onClick={() => iniciarAsignar(carga)}
                      disabled={loadingMaquina}
                      className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Asignar máquina
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Una nota sin ninguna carga no lista nada aquí: en Por Encargo su
              primera máquina se da con "+ Agregar" del encabezado. En
              Autoservicio no puede pasar — la nota nace con sus cargas. */}
        </div>
      </div>

      {/* Granel de cada servicio Por Encargo (migs. 132-134): qué jabón y qué
          suavizante usa cada uno. Se elige aquí, y sin elegir no arranca la
          lavadora. Se esconde sola si la nota no lleva granel por servicio. */}
      <GranelPorServicio nota={nota} puedeEditar={puedeTocarProductos} onCambio={cargarDatos} />

      {/* Sección 2 — Productos de la nota. Se capturan al hacerla, pero también
          se pueden agregar aquí (2026-09-25): el cliente pide el jabón ya
          estando en la máquina. El admin además puede quitar uno mal capturado. */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
          {puedeTocarProductos && (
            <button
              onClick={iniciarAgregarProducto}
              disabled={loadingProducto != null}
              className="flex items-center gap-1 text-xs font-medium text-blue hover:underline disabled:opacity-60"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Agregar
            </button>
          )}
        </div>
        {productosNota.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">Sin productos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* Mismo renglón que en Nueva Nota (2026-10-02): nombre y precio
                por unidad arriba; abajo la cantidad, el importe y el bote. */}
            {productosNota.map(p => (
              <div key={p.producto_id} className="flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4">
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-sm font-semibold text-gray-900">{etiquetaProducto(p)}</p>
                  <p className="text-xs text-gray-500 tabular-nums">
                    {fmtMonto(p.precio_unitario)}/{unidadDeRenglon(p)}
                  </p>
                </div>

                <div className="flex flex-1 items-center justify-between gap-2">
                  {/* Servir más o menos sin borrar el renglón. El − se detiene
                      en 1: quitarlo del todo es otra cosa, y tiene su bote de
                      basura (que además es de admin). */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => cambiarCantidadProducto(p.producto_id, Number(p.cantidad) - 1)}
                      disabled={!puedeTocarProductos || Number(p.cantidad) <= 1 || loadingProducto != null}
                      aria-label={`Servir menos ${tituloProducto(p)}`}
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-gray-900 tabular-nums">
                      {p.cantidad}
                    </span>
                    <button
                      onClick={() => cambiarCantidadProducto(p.producto_id, Number(p.cantidad) + 1)}
                      disabled={!puedeTocarProductos || loadingProducto != null}
                      aria-label={`Servir más ${tituloProducto(p)}`}
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-16 text-right text-base font-bold text-blue-700 tabular-nums">
                      {fmtMonto(p.subtotal)}
                    </span>
                    {esAdmin && !cobroCongelado && (
                      <button
                        onClick={() => setConfirmQuitarProd(p)}
                        disabled={loadingProducto === p.producto_id}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Quitar producto"
                        aria-label={`Quitar ${tituloProducto(p)}`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {/* Suma de los productos. El total de la nota (máquinas, ajuste y
                todo lo demás) vive en el detalle, no en esta tarjeta. */}
            <div className="px-4 py-3 bg-gray-50 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total productos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalProductosNota)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal agregar producto: la MISMA lista del alta (2026-09-28). Antes era
          un desplegable con un campo de cantidad; se elige de una lista donde
          cada producto enseña su precio y lo que queda, que es lo que hace falta
          para decidir. Entra con 1 y desde el renglón se sube con el +. */}
      {agregarProdOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setAgregarProdOpen(false); setErrorAccion(''); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Agregar producto</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {esEncargo ? 'El granel se sirve por medida' : 'Se cobra por pieza completa'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAgregarProdOpen(false); setErrorAccion(''); }}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {errorAccion && (
              <div className="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            <div className="p-3 overflow-y-auto">
              {loadingCatalogo ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
                </div>
              ) : catalogoProd.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-gray-500">
                  No hay productos dados de alta.
                </p>
              ) : (() => {
                // Los que la nota ya lleva no se ofrecen otra vez: para servir
                // más se sube la cantidad del renglón que ya existe.
                const puestos = productosNota.map(x => String(x.producto_id));
                const hayAlguno = catalogoProd.some(p =>
                  !puestos.includes(String(p.id)) && existenciaProducto(p) > 0);
                return (
                  <div className="space-y-1.5">
                    {!hayAlguno && (
                      <p className="px-3 py-3 mb-1 text-sm text-bronce bg-light-bronce border border-bronce/30 rounded-xl">
                        La nota ya lleva todos los productos disponibles. Para servir más de alguno,
                        sube su cantidad en la lista.
                      </p>
                    )}
                    {catalogoProd.map(p => {
                      const yaEsta    = puestos.includes(String(p.id));
                      const sinStock  = existenciaProducto(p) <= 0;
                      const bloqueado = yaEsta || sinStock || loadingProducto != null;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={bloqueado}
                          onClick={() => agregarProductoDeLista(p.id)}
                          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-colors ${
                            bloqueado
                              ? 'border-gray-100 bg-gray-50 cursor-not-allowed'
                              : 'border-gray-200 hover:border-blue hover:bg-light-blue/40'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-base font-semibold ${bloqueado ? 'text-gray-400' : 'text-gray-900'}`}>
                              {etiquetaProducto(p)}
                            </p>
                            <p className="text-xs text-gray-500 tabular-nums">{detalleProducto(p)}</p>
                          </div>
                          {yaEsta ? (
                            <span className="flex-shrink-0 text-xs font-semibold text-gray-500 bg-gray-200 rounded-pill px-2.5 py-1">
                              Ya está en la nota
                            </span>
                          ) : sinStock ? (
                            <span className="flex-shrink-0 text-xs font-semibold text-red bg-light-red rounded-pill px-2.5 py-1">
                              Sin existencias
                            </span>
                          ) : (
                            <svg className="w-5 h-5 flex-shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setAgregarProdOpen(false); setErrorAccion(''); }}
                className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmQuitarProd && (
        <ConfirmacionModal
          titulo="Quitar producto"
          mensaje={`Se quitará ${confirmQuitarProd.cantidad} × ${confirmQuitarProd.nombre} de esta nota y volverá al inventario.`}
          detalle={[
            { etiqueta: 'Deja de cobrarse', valor: fmtMonto(confirmQuitarProd.subtotal) },
            { etiqueta: 'Nuevo total de la nota',
              valor: fmtMonto(Number(nota?.precio_total || 0) - Number(confirmQuitarProd.subtotal || 0)) },
          ]}
          textoConfirmar={loadingProducto === confirmQuitarProd.producto_id ? 'Quitando…' : 'Quitar producto'}
          procesando={loadingProducto === confirmQuitarProd.producto_id}
          error={errorAccion}
          onClose={() => setConfirmQuitarProd(null)}
          onConfirm={() => eliminarProducto(confirmQuitarProd.producto_id)}
        />
      )}

      {/* Quitar una carga: mismo peso que quitar un producto, porque también
          baja el total de la nota. Antes era un confirm() del navegador, que
          además no decía cuánto dejaba de cobrarse. */}
      {confirmQuitarCarga && (() => {
        // Siempre la versión recién cargada: el importe y las máquinas de la
        // carga pueden haber cambiado mientras el modal estaba abierto.
        const c = cargasNota.find(x => String(x.id) === String(confirmQuitarCarga.id)) ?? confirmQuitarCarga;
        const nombre  = renglon;
        const Nombre  = Renglon;
        const importe = costoDeCarga(c);
        const fisicas = [c.lavadora_nombre, c.secadora_nombre].filter(Boolean);
        return (
          <ConfirmacionModal
            titulo={`Quitar la ${Nombre} ${numeroDeCarga(c)}`}
            mensaje={`Sale de la nota y deja de cobrarse.`
              + (fisicas.length > 0
                ? ` ${fisicas.join(' y ')} ${fisicas.length > 1 ? 'vuelven' : 'vuelve'} a quedar disponible${fisicas.length > 1 ? 's' : ''}.`
                : '')}
            puntos={[
              (c.productos ?? []).length > 0
                ? 'Los productos que tenía apartados vuelven al inventario.' : null,
            ]}
            detalle={[
              { etiqueta: 'Deja de cobrarse', valor: fmtMonto(importe) },
              { etiqueta: 'Nuevo total de la nota',
                valor: fmtMonto(Number(nota?.precio_total || 0) - importe) },
            ]}
            textoConfirmar={loadingMaquina ? 'Quitando…' : `Quitar ${nombre}`}
            procesando={loadingMaquina}
            error={errorAccion}
            onClose={() => { setConfirmQuitarCarga(null); setErrorAccion(''); }}
            onConfirm={async () => {
              // Se cierra solo si salió bien; si no, el motivo se lee dentro.
              if (await quitarCarga(confirmQuitarCarga)) setConfirmQuitarCarga(null);
            }}
          />
        );
      })()}

      {/* Animaciones de encender / iniciar / detener ciclo */}
      {/* Elegir con cuál de los tiempos del modelo corre el ciclo (mig. 120).
          Va antes de la animación: primero se decide, luego arranca. */}
      {eligiendoTiempo && !iniciando && !encendiendo && (
        <ElegirTiempoModal
          maquina={eligiendoTiempo.maquina}
          tiempos={tiemposDeMaquina(eligiendoTiempo.maquina)}
          guardando={loadingMaquina}
          error={errorAccion}
          onElegir={elegirTiempo}
          onCancelar={() => { setEligiendoTiempo(null); setErrorAccion(''); }}
        />
      )}

      {encendiendo && <MaquinaCicloOverlay modo="encender" tipo={encendiendo.tipo} nombre={encendiendo.nombre} />}
      {iniciando && <MaquinaCicloOverlay modo="iniciar" tipo={iniciando.tipo} nombre={iniciando.nombre} />}
      {deteniendo && <MaquinaCicloOverlay modo="detener" tipo={deteniendo.tipo} nombre={deteniendo.nombre} />}

      {/* Modal de arranque de una máquina: los dos pasos de la mig. 110 en la
          misma ventana. Se esconde mientras corre una animación para no taparla
          (el overlay va antes en el DOM) y vuelve ya con el paso siguiente. */}
      {maqModal && !encendiendo && !iniciando && (() => {
        const esSecadora = maqModal.tipo === 'secadora';
        const esIniciar  = pasoModal === 'iniciar';
        const accion     = esSecadora ? 'secado' : 'lavado';
        // Minutos elegidos para esta vuelta, en el modelo que los pregunta.
        const minElegidos = minutosDeMaquina(maqModal);
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                {esIniciar ? (
                  /* Ícono de "play" (empezar) */
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                ) : (
                  /* Ícono de rayo (corriente) */
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
                  </svg>
                )}
              </span>
              <h3 className="text-base font-bold text-gray-900">
                {esIniciar
                  ? (esSecadora ? 'Iniciar secado' : 'Iniciar lavado')
                  : 'Encender máquina'}
              </h3>
            </div>

            {esIniciar ? (
              /* El modelo que pregunta su tiempo se marca en SU pantalla, no
                 aquí: este botón solo confirma que ya está girando, que es
                 cuando el cronómetro debe empezar. */
              preguntaSuTiempo ? (
                <p className="text-sm text-gray-500">
                  ¿Ya está girando{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>? Desde aquí
                  empiezan a correr{' '}
                  {minElegidos != null
                    ? <>los <span className="font-semibold text-gray-800">{minElegidos} min</span> que elegiste</>
                    : 'los minutos del ciclo'}, así que confírmalo solo cuando ya la hayas
                  arrancado con su botón.
                </p>
              ) : maqModal.arrancaSola ? (
                /* La que arranca sola: al confirmar recibe corriente y empieza
                   a lavar, así que no hay nada que apretar en la máquina ni
                   tiempo que se descuente (mig. 122). */
                <p className="text-sm text-gray-500">
                  ¿Iniciar el {accion} de{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>? Esta máquina
                  arranca sola al recibir corriente: al confirmar empieza el {accion} y el tiempo del
                  ciclo corre desde ya.
                </p>
              ) : (
                <p className="text-sm text-gray-500">
                  ¿Iniciar el {accion} de{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>? Desde aquí
                  empieza a correr el tiempo del ciclo, así que hazlo cuando ya la hayas arrancado con su
                  botón: lo que tardes de más se le descuenta al {accion}.
                </p>
              )
            ) : maqModal.cronometro ? (
              /* Cronómetro: no hay segundo paso. La que arranca sola (Speed
                 Queen) no necesita que le aprieten nada. */
              <p className="text-sm text-gray-500">
                Se le da corriente a{' '}
                <span className="font-semibold text-gray-800">{maqModal.nombre}</span> y empieza a
                correr el cronómetro.{maqModal.arrancaSola
                  ? ' Arranca sola al recibir corriente.'
                  : ' Carga la ropa y arráncala con su botón.'} Cuando termine, finalízala desde su
                tarjeta: ahí se le corta la luz.
              </p>
            ) : preguntaSuTiempo && minElegidos != null ? (
              <p className="text-sm text-gray-500">
                Se le da corriente a{' '}
                <span className="font-semibold text-gray-800">{maqModal.nombre}</span>. En su pantalla
                marca <span className="font-semibold text-gray-800">{minElegidos} min</span> —cada
                toque sube de 10 en 10— y arráncala con su botón. El tiempo todavía NO empieza: se
                confirma en el paso siguiente, aquí mismo.
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Se le da corriente a{' '}
                <span className="font-semibold text-gray-800">{maqModal.nombre}</span> para que puedas
                cargar la ropa y arrancarla con su botón. El tiempo del ciclo todavía NO empieza: eso
                es el paso siguiente, aquí mismo.
              </p>
            )}

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* Secundaria: cambiar esta máquina por otra. Solo mientras no
                tenga corriente: una vez encendida el cliente ya le está
                cargando la ropa, así que cambiarla deja de tener sentido. La
                que arranca sola se salta el primer paso pero sigue estando
                apagada hasta confirmar, así que ahí también se ofrece. */}
            {(!esIniciar || (maqModal.arrancaSola && !maqModal.esperandoArranque)) && (
              <button
                type="button"
                onClick={cambiarDesdeModal}
                disabled={loadingMaquina}
                aria-label="Cambiar máquina"
                title="Cambiar máquina"
                className="w-full flex items-center justify-center border border-gray-300 text-gray-700 py-2.5 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            )}

            {/* Principales: la del paso (destacada) y cancelar, apiladas a ancho completo */}
            <div className="space-y-2.5">
              {esIniciar ? (
                <button
                  type="button"
                  onClick={iniciarMaquina}
                  disabled={loadingMaquina}
                  className="w-full bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {loadingMaquina
                    ? 'Iniciando...'
                    : (esSecadora ? 'Iniciar Secado' : 'Iniciar Lavado')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={encenderDesdeModal}
                  disabled={loadingMaquina}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  Encender máquina
                </button>
              )}
              <button
                type="button"
                onClick={() => setMaquinaModalId(null)}
                disabled={loadingMaquina}
                className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal cambiar máquina — elegir otra del mismo tipo */}
      {cambiarMaq && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">Cambiar máquina</h3>
              <p className="text-sm text-gray-500 mt-1">
                Reemplaza <span className="font-semibold text-gray-800">{cambiarMaq.nombre}</span> por otra{' '}
                {cambiarMaq.tipo === 'secadora' ? 'secadora' : 'lavadora'} disponible. La tarifa se ajusta al tamaño de la nueva máquina.
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {loadingMaquinas ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : maquinasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No hay otras {cambiarMaq.tipo === 'secadora' ? 'secadoras' : 'lavadoras'} disponibles.
              </p>
            ) : (
              <div className="space-y-2">
                {maquinasDisp.map(m => {
                  const selected = String(cambiarSel) === String(m.id);
                  // "Marca · Tamaño", igual que al agregar máquina.
                  const tamanoLabel = marcaYTamano(m);
                  // Reservada por otra nota abierta: se muestra pero no se elige.
                  const reservada = Boolean(m.reservada);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={reservada}
                      onClick={() => setCambiarSel(selected ? '' : String(m.id))}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                        reservada
                          ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                          : selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span className="font-medium text-gray-800">{m.nombre}</span>
                      <span className="flex items-center gap-2">
                        {reservada && (
                          <span className="text-xs font-medium text-amber-600">
                            Reservada{m.reservada_folio ? ` (${m.reservada_folio})` : ''}
                          </span>
                        )}
                        {tamanoLabel && (
                          <span className="text-xs text-gray-500">{tamanoLabel}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setCambiarMaq(null)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarCambiar}
                disabled={loadingMaquina || !cambiarSel}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Cambiando...' : 'Cambiar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar detener ciclo */}
      {confirmDetener && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                {/* Ícono de advertencia */}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">Detener ciclo</h3>
            </div>
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
      {confirmTerminarMaq && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Terminar ciclo</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmTerminarMaq.nombre}</span> ya terminó?{' '}
              {confirmTerminarMaq.tipo === 'secadora' ? 'La secadora' : 'La lavadora'} pasará a disponible.
            </p>
            {/* A la nota le puede quedar trabajo que no está corriendo: una
                máquina sin asignar, una ya asignada que nadie ha arrancado
                —lo habitual desde que la secadora se pone desde el principio—,
                o una que otra nota se llevó. En los tres casos la nota sigue en
                proceso, y el motivo dice cuál de ellos es. */}
            {motivoTerminar ? (
              <p className="text-sm text-gray-500">
                La nota sigue en proceso{motivoTerminar} Aún no pasa a "{estadoAlCerrar}".
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                La nota pasará a estado <span className="font-semibold text-gray-800">"{estadoAlCerrar}"</span>.
                {estadoAlCerrar !== 'Finalizada' && esAutoservicio && ' Ahí se liquida.'}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmTerminarMaq(null)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={terminarCicloMaquina}
                disabled={loadingMaquina}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Terminando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal asignar máquina extra: elegir la máquina y a qué carga va */}
      {asignarOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {/* Sin carga destino se abre una carga nueva: ahí se AGREGA
                    una máquina a la nota, no se asigna a algo que ya existe. */}
                {cargaDestino
                  ? `Asignar máquina · ${Renglon} ${numeroDeCarga(cargaDestino)}`
                  : 'Agregar máquina'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {asignarSlot
                  ? <>Elige la <span className="font-medium text-gray-700">
                      {/* Sin tamaño: sirve cualquier lavadora libre
                          (2026-09-26). El edredón es la excepción, y ahí sí se
                          nombra porque la lista solo trae jumbos. */}
                      {asignarSlot.slot === 'lavadora'
                        ? (esEdredonCarga(asignarSlot.carga) ? 'lavadora Jumbo' : 'lavadora')
                        : 'secadora'}
                    </span> que le falta a la {Renglon} {numeroDeCarga(cargaDestino)}. Queda asignada; la inicias después con su botón.</>
                  : cargaDestino
                    ? <>La máquina se suma a la <span className="font-medium text-gray-700">{Renglon} {numeroDeCarga(cargaDestino)}</span> <span className="font-medium text-gray-700">sin cobro</span>: no cambia el total de la nota. Queda asignada; la inicias después con su botón.</>
                    : <>Entra como una <span className="font-medium text-gray-700">máquina más de la nota</span> y{' '}
                      {/* En Autoservicio lo que se cobra ES la máquina, así que
                          una de más suma su tarifa. En Por Encargo se cobró el
                          servicio al hacer la nota: la máquina no mueve nada. */}
                      <span className="font-medium text-gray-700">
                        {esAutoservicio ? 'se cobra su tarifa' : 'no cambia el total de la nota'}
                      </span>. Queda asignada; la inicias después con su botón.</>}
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* A qué carga se suma. Siempre es una carga que ya existe: desde
                Salidas no se abren cargas nuevas, para eso está una nota nueva
                (2026-09-22). Solo se ofrece cuando el modal viene de
                "+ Agregar" (sin destino fijo) y hay más de una candidata. */}
            {!asignarCargaFija && !porMaquinas && cargasDestino.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dónde va</p>
                <div className="flex flex-wrap gap-2">
                  {cargasDestino.map(c => {
                    const h = huecosDeCarga(c);
                    // Qué ADMITE, no qué le falta: una carga que ya lavó y secó
                    // vuelve a admitir las dos, y decir "vacía" sería mentira.
                    const admite = h.lavadora && h.secadora ? 'lavadora o secadora'
                                 : h.lavadora ? 'solo lavadora' : 'solo secadora';
                    const sel = cargaDestino != null && String(cargaDestino.id) === String(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => elegirDestino(c)}
                        className={`flex flex-col items-start gap-0.5 px-4 py-2 border-2 rounded-xl text-left transition-colors ${
                          sel ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-800">{Renglon} {numeroDeCarga(c)}</span>
                        <span className="text-xs text-gray-500">{admite}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Máquina (lavadora o secadora) */}
            {loadingMaquinas ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue" />
              </div>
            ) : lavadorasDisp.length === 0 && secadorasDisp.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay máquinas disponibles.</p>
            ) : (
              <div className="space-y-4">
                {/* Lavadoras — solo si el destino tiene hueco de lavadora */}
                {huecosAsignar.lavadora && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lavadoras</p>
                  {lavadorasDisp.length === 0 ? (
                    <p className="text-sm text-gray-400">No hay lavadoras disponibles.</p>
                  ) : (
                    lavadorasDisp.map(m => {
                      const selected = asignarMaqSel.includes(String(m.id));
                      // Otra nota ya la tiene asignada: se puede elegir igual
                      // (se la queda quien inicie primero), pero se avisa.
                      const reservada = Boolean(m.reservada);
                      // La que esta carga acaba de usar: va primera y lo dice.
                      const sugerida = String(m.id) === String(idUltimaLav);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleAsignarMaq(m.id)}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            selected ? 'border-blue bg-light-blue'
                              : reservada ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                              : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <SelCheck on={selected} />
                            <span className="font-medium text-gray-800 truncate">{m.nombre}</span>
                            {sugerida && (
                              <span className="text-xs font-medium text-blue bg-light-blue rounded-pill px-2 py-0.5 flex-shrink-0">
                                acaba de terminar
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {reservada && (
                              <span className="text-xs font-medium text-amber-600">
                                También en {m.reservada_folio ?? 'otra nota'}
                              </span>
                            )}
                            {marcaYTamano(m) && (
                              <span className="text-xs text-gray-500">{marcaYTamano(m)}</span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                )}

                {/* Secadoras — solo si el destino tiene hueco de secadora */}
                {huecosAsignar.secadora && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Secadoras</p>
                  {secadorasDisp.length === 0 ? (
                    <p className="text-sm text-gray-400">No hay secadoras disponibles.</p>
                  ) : (
                    secadorasDisp.map(m => {
                      const selected = asignarMaqSel.includes(String(m.id));
                      // Otra nota ya la tiene asignada: se puede elegir igual
                      // (se la queda quien inicie primero), pero se avisa.
                      const reservada = Boolean(m.reservada);
                      // La que esta carga acaba de usar: va primera y lo dice.
                      const sugerida = String(m.id) === String(idUltimaSec);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleAsignarMaq(m.id)}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            selected ? 'border-blue bg-light-blue'
                              : reservada ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                              : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <SelCheck on={selected} />
                            <span className="font-medium text-gray-800 truncate">{m.nombre}</span>
                            {sugerida && (
                              <span className="text-xs font-medium text-blue bg-light-blue rounded-pill px-2 py-0.5 flex-shrink-0">
                                acaba de terminar
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {reservada && (
                              <span className="text-xs font-medium text-amber-600">
                                También en {m.reservada_folio ?? 'otra nota'}
                              </span>
                            )}
                            {marcaYTamano(m) && (
                              <span className="text-xs text-gray-500">{marcaYTamano(m)}</span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={cerrarAsignar}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAsignar}
                disabled={loadingMaquina || asignarMaqSel.length === 0}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina
                  ? 'Asignando...'
                  : asignarMaqSel.length > 1 ? `Asignar (${asignarMaqSel.length})` : 'Asignar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
