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
import AbrirCajaModal from '../components/AbrirCajaModal';
import ElegirTiempoModal from '../components/ElegirTiempoModal';
import GranelPorServicio from '../components/GranelPorServicio';
import { preguntaTiempo, tiemposDeMaquina, etiquetaPrograma } from '../lib/tiemposModelo';
import { marcaYTamano } from '../lib/estadoMaquina';
import { cobroAparteEncargo, bolsasIncluidas } from '../lib/cobroProductos';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

/**
 * Unidad de un producto de la nota para el "$28.00/pieza": medida (Por
 * Encargo), bolsa, pieza (marca y polvo) o botella (granel). Como en Nueva Nota.
 */
function unidadDeRenglon(p) {
  if (p.unidad === 'medida') return 'medida';
  if (p.clase === 'bolsa') return 'bolsa';
  if (seVendePorUnidad(p)) return 'pieza';
  return 'botella';
}

/**
 * Muestra "Detener Lavado/Secado" (libera la máquina y la manda apagar). Es una
 * bandera porque los empleados no pueden consultar el estado del driver.
 */
const MOSTRAR_DETENER_CICLO = true;

const BADGE_MAQUINA_ESTADO = {
  // Asignada a la carga pero sin iniciar: gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  // Ya cumplió su parte y se soltó de la carga: verde.
  terminado:     { label: 'Terminó',       cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

/** ¿La carga lleva edredón? */
const esEdredonCarga = (c) => String(c?.tipo_prenda ?? '').toUpperCase() === 'EDREDON';


/** Casilla de la multiselección de máquinas. */
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
  // Producto por quitar, esperando confirmación (solo admin).
  const [confirmQuitarProd, setConfirmQuitarProd] = useState(null);
  // Agregar un producto desde Salidas: el cliente lo pide ya frente a la máquina.
  const [agregarProdOpen, setAgregarProdOpen] = useState(false);
  const [catalogoProd, setCatalogoProd]       = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(false);

  const [confirmQuitarCarga, setConfirmQuitarCarga] = useState(null);
  const [errorAccion,      setErrorAccion]      = useState('');
  // Con la caja cerrada no se agregan ni encienden máquinas ni se cambian
  // productos (el servidor responde 409); Finalizar y Detener sí se pueden.
  const [cajaAbierta,      setCajaAbierta]      = useState(null);
  const [modalCajaOpen,    setModalCajaOpen]    = useState(false);
  useEffect(() => {
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null)); // si falla la consulta, no se avisa nada
  }, []);
  /** Error de una acción; si fue por la caja cerrada, además sale el aviso de arriba. */
  const fallaAccion = (err, texto = err.message) => {
    if (err?.data?.code === 'CAJA_CERRADA') setCajaAbierta(false);
    setErrorAccion(texto);
  };
  const [confirmDetener,   setConfirmDetener]   = useState(null); // máquina a detener
  // Máquina del modal de arranque. Se guarda el id: el paso (encender o iniciar)
  // sale del estado vivo de la máquina, que cambia sin cerrar el modal.
  const [maquinaModalId,   setMaquinaModalId]   = useState(null);
  const [iniciando,        setIniciando]        = useState(null); // máquina arrancando (animación)
  // Máquina esperando que se elija su programa: { maquina, paso } ('encender' o
  // 'iniciar'), porque al elegir se hace algo distinto en cada paso.
  const [eligiendoTiempo,  setEligiendoTiempo]  = useState(null);
  // Programa elegido al encender, hasta que se inicie. Solo en memoria: si la
  // pantalla se recarga, se vuelve a preguntar.
  const [minutosPorMaquina, setMinutosPorMaquina] = useState({});
  const [encendiendo,      setEncendiendo]      = useState(null); // máquina recibiendo corriente
  const [deteniendo,       setDeteniendo]       = useState(null); // máquina deteniéndose (animación)
  // "Más fichas" de la secadora de fichas: la máquina mientras se elige el tiempo.
  const [confirmOtraFicha, setConfirmOtraFicha] = useState(null);

  // Máquinas libres para los modales de asignar y cambiar.
  const [maquinasDisp,     setMaquinasDisp]     = useState([]);
  const [loadingMaquinas,  setLoadingMaquinas]  = useState(false);
  // Todas las máquinas de la sucursal: para los huecos con tipo que esperan máquina.
  const [todasMaquinas,    setTodasMaquinas]    = useState([]);

  // Modal "Asignar Máquina": varias a la vez; lavadora y secadora se emparejan en
  // una carga. En Autoservicio se cobra; en Por Encargo va sin cobro.
  const [asignarOpen,      setAsignarOpen]      = useState(false);
  const [asignarMaqSel,    setAsignarMaqSel]    = useState([]); // ids seleccionados
  // Carga a la que se suma la máquina; null = carga nueva.
  const [asignarCarga,     setAsignarCarga]     = useState(null);
  // true si el modal se abrió desde una carga: no se ofrece elegir destino.
  const [asignarCargaFija, setAsignarCargaFija] = useState(false);
  // Modo hueco: { carga, slot, tipo } de una carga a la que le falta la máquina
  // de un tipo ya elegido. No se pregunta cobro ni destino.
  const [asignarSlot,      setAsignarSlot]      = useState(null);

  // Cambiar una máquina asignada (sin iniciar) por otra del mismo tipo.
  const [cambiarMaq,       setCambiarMaq]       = useState(null); // máquina a cambiar
  const [cambiarSel,       setCambiarSel]       = useState('');

  // Finalizar una máquina (si es la última, la nota se cierra).
  const [confirmTerminarMaq, setConfirmTerminarMaq] = useState(null); // máquina por cerrar

  // Tiempos por tipo (Ajustes) y reloj, para saber si un ciclo ya se cumplió.
  const [tiempos, setTiempos] = useState({ mediana: 30, jumbo: 45, secadora: 30 });
  const [now, setNow] = useState(() => Date.now());

  // Si un cambio devuelve a PENDIENTE una nota cobrada, se deja la señal con los
  // dos importes; el aviso se ve en el Detalle. En ref para no hacer depender a
  // cargarDatos del estado.
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
    // Cargar al montar y al cambiar id; no es un bucle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarDatos().finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [cargarDatos]);

  // En Autoservicio todo se cobra: no se pregunta al asignar.
  const esAutoservicio = nota?.tipo_servicio === 'AUTOSERVICIO';
  const esEncargo      = nota?.tipo_servicio === 'POR_ENCARGO';
  // Autoservicio y Por Encargo hablan de "máquinas" (un renglón por máquina);
  // solo el servicio EDREDON habla de "cargas".
  const porMaquinas   = esAutoservicio || esEncargo;
  const Renglon       = porMaquinas ? 'Máquina' : 'Carga';
  const renglon       = porMaquinas ? 'máquina' : 'carga';
  // Cobro en un corte cerrado: no se ofrece nada que mueva el total.
  const cobroCongelado = Boolean(nota?.cobro_congelado);

  // Máquinas asignadas a la nota, sin repetir.
  const cargasNota = nota?.cargas ?? [];
  const maquinasNota = [...new Set(
    cargasNota.flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean)
  )];

  // "Encender": da corriente sin arrancar el ciclo. El modal sigue abierto
  // durante la animación y vuelve con el paso de iniciar.
  async function encenderMaquina(maq) {
    if (!maq) return;
    setErrorAccion('');
    setEncendiendo(maq); // arranca la animación de encendido
    try {
      // Mínimo para que la animación se vea.
      await Promise.all([
        api.patch(`/notas/${id}/encender-maquina`, { maquina_id: maq.id }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      // Con cronómetro no hay paso siguiente: ya quedó corriendo.
      if (maq.cronometro) setMaquinaModalId(null);
      await cargarDatos();
    } catch (err) {
      fallaAccion(err);
    } finally {
      setEncendiendo(null);
    }
  }

  // Encender (desde el modal o el botón del renglón). Con temporizador, el modelo
  // que pregunta su programa lo pregunta antes de dar corriente; con cronómetro,
  // al iniciar.
  function encenderDesdeModal(maq = maqModal) {
    if (!maq) return;
    setErrorAccion('');
    if (!maq.cronometro && preguntaTiempo(maq) && minutosDeMaquina(maq) == null) {
      setEligiendoTiempo({ maquina: maq, paso: 'encender' });
      return;
    }
    return encenderMaquina(maq);
  }

  // Iniciar (desde el modal o el botón del renglón). Si el modelo pregunta su
  // programa y no se eligió al encender (o se perdió), se pregunta aquí.
  function iniciarMaquina(maq = maqModal) {
    if (!maq) return;
    setErrorAccion('');
    if (preguntaTiempo(maq)) {
      const min = minutosDeMaquina(maq);
      if (min != null) return arrancarMaquina(maq, min);
      setEligiendoTiempo({ maquina: maq, paso: 'iniciar' });
      return;
    }
    return arrancarMaquina(maq, null);
  }

  // Al encender se guarda el programa y se da corriente; al iniciar, arranca el ciclo.
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
      // Mínimo para que la animación (agua llenándose) se vea.
      await Promise.all([
        api.patch(`/notas/${id}/activar-pendientes`, {
          maquina_id: maq.id, ...(minutos != null && { minutos }),
        }),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
      setEligiendoTiempo(null);
      setMaquinaModalId(null);
      // El ciclo ya quedó sellado: se olvida la elección para la siguiente vuelta.
      setMinutosPorMaquina(prev => {
        const { [maq.id]: _ya, ...resto } = prev;
        return resto;
      });
      await cargarDatos();
    } catch (err) {
      // El modal sigue abierto detrás y ahí se ve el error.
      fallaAccion(err);
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

  // Ningún botón abre el modal de arranque: Encender e Iniciar actúan al tocarlos.

  // Pone una máquina física en un hueco con tipo; queda asignada sin arrancar.
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
      fallaAccion(err);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el modal de asignar para el hueco de una carga (solo se elige la máquina).
  function iniciarAsignarSlot(carga, slot) {
    setErrorAccion('');
    setAsignarMaqSel([]);
    setAsignarCarga(carga);
    setAsignarCargaFija(true);
    setAsignarSlot({ carga, slot });
    setAsignarOpen(true);
  }

  // Cierra el modal de asignar y lo deja limpio.
  function cerrarAsignar() {
    setAsignarOpen(false);
    setAsignarCarga(null);
    setAsignarCargaFija(false);
    setAsignarSlot(null);
  }

  // Detiene el ciclo de una máquina; las demás no se tocan.
  async function detenerCiclo() {
    if (!confirmDetener) return;
    const maq = confirmDetener;
    setLoadingMaquina(true);
    setErrorAccion('');
    setDeteniendo(maq); // arranca la animación de detener
    try {
      // Mínimo para que la animación se vea.
      await Promise.all([
        api.patch(`/maquinas/${maq.id}/detener-ciclo`),
        new Promise((r) => setTimeout(r, 1700)),
      ]);
      setConfirmDetener(null);
      await cargarDatos();
    } catch (err) {
      // El modal sigue abierto detrás y ahí se ve el error.
      fallaAccion(err);
    } finally {
      setDeteniendo(null);
      setLoadingMaquina(false);
    }
  }

  // Abre el selector de máquina: sin argumento, un renglón nuevo; con una carga, esa carga.
  async function iniciarAsignar(carga = null) {
    setErrorAccion('');
    setAsignarMaqSel([]);
    // Donde se cuenta por máquinas, la extra abre su propio renglón. El selector de
    // destino solo se oculta si el modal se abrió desde un renglón.
    setAsignarCarga(carga ?? (porMaquinas ? null : cargasDestino[0] ?? null));
    setAsignarCargaFija(Boolean(carga));
    setAsignarSlot(null);
    setAsignarOpen(true);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      // Sin las que ya tiene esta nota ni las asignadas a otra nota abierta.
      setMaquinasDisp((data ?? []).filter(m =>
        m.estado === 'disponible'
        && !m.reservada
        && !maquinasNota.some(mid => String(mid) === String(m.id))));
    } catch (err) {
      fallaAccion(err);
    } finally {
      setLoadingMaquinas(false);
    }
  }

  // Alterna una máquina en la selección. En una carga existente cabe una por
  // hueco: la nueva reemplaza a la del mismo tipo.
  function toggleAsignarMaq(maqId) {
    const s = String(maqId);
    const esSec = (mid) => maquinasModal.some(m => String(m.id) === String(mid) && m.tipo === 'secadora');
    setAsignarMaqSel(prev => {
      if (prev.includes(s)) return prev.filter(x => x !== s);
      // Por máquinas se elige una: si hacen falta dos, se repite "+ Agregar".
      if (porMaquinas) return [s];
      if (asignarCarga) return [...prev.filter(x => esSec(x) !== esSec(s)), s];
      return [...prev, s];
    });
  }

  // Cambia la carga destino y limpia la selección (cambian los huecos).
  function elegirDestino(carga) {
    setErrorAccion('');
    setAsignarCarga(carga);
    setAsignarMaqSel([]);
  }

  // Asigna las máquinas elegidas (sin iniciar). En Por Encargo van sin cobro; en
  // Autoservicio se cobra su tarifa.
  async function confirmarAsignar() {
    if (asignarMaqSel.length === 0) return;
    // Sin destino, la máquina abre su renglón; solo el servicio EDREDON elige carga.
    if (!asignarSlot && !asignarCarga && !porMaquinas) return;
    // Modo hueco: la carga ya existe y está cobrada; solo se le pone máquina.
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
        // Sin carga destino, el backend abre una nueva.
        ...(asignarCarga ? { carga_id: asignarCarga.id } : {}),
      });
      cerrarAsignar();
      await cargarDatos();
    } catch (err) {
      fallaAccion(err);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Modal para cambiar una máquina (sin iniciar) por otra del mismo tipo.
  async function iniciarCambiar(m) {
    setErrorAccion('');
    setCambiarSel('');
    setCambiarMaq(m);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      const esSecadora = m.tipo === 'secadora';
      // Del mismo tipo, libres y sin asignar a esta ni a otra nota.
      setMaquinasDisp((data ?? []).filter(x =>
        x.estado === 'disponible'
        && !x.reservada
        && (esSecadora ? x.tipo === 'secadora' : x.tipo !== 'secadora')
        && !maquinasNota.some(mid => String(mid) === String(x.id))));
    } catch (err) {
      fallaAccion(err);
    } finally {
      setLoadingMaquinas(false);
    }
  }

  // Cambia la máquina (el backend re-tarifa si el hueco se cobraba).
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
      fallaAccion(err);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // "Finalizar": cierra la carga de esa máquina; si a la nota no le queda nada,
  // pasa a Por Entregar. La lavadora termina sin pasar a secado.
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
      fallaAccion(err);
      setConfirmTerminarMaq(null);
    } finally {
      setLoadingMaquina(false);
    }
  }

  // Abre el modal con los productos activos de la sucursal.
  async function iniciarAgregarProducto() {
    setErrorAccion('');
    setAgregarProdOpen(true);
    setLoadingCatalogo(true);
    try {
      const data = await api.get('/productos');
      setCatalogoProd(data ?? []);
    } catch (err) {
      fallaAccion(err);
    } finally {
      setLoadingCatalogo(false);
    }
  }

  // Agrega un producto con cantidad 1 (se sube con el +). Precio y unidad los pone
  // el servidor según el servicio; queda apartado del inventario.
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
      fallaAccion(err);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Cambia la cantidad. Manda la cantidad final, no un delta: dos clics a la vez
  // no se suman.
  async function cambiarCantidadProducto(productoId, cantidad) {
    if (cantidad < 1) return;
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/productos/${productoId}`, { cantidad });
      await cargarDatos();
    } catch (err) {
      fallaAccion(err);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Quita un producto (admin): vuelve al inventario y el total baja.
  async function eliminarProducto(productoId) {
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}/productos/${productoId}`);
      setConfirmQuitarProd(null);
      await cargarDatos();
    } catch (err) {
      // El error se ve dentro del modal: el aviso de la página queda fuera de vista.
      fallaAccion(err);
    } finally {
      setLoadingProducto(null);
    }
  }

  // Quita una carga que no se va a usar (solo sin máquinas arrancadas). Devuelve
  // si se pudo, para que el modal muestre el rechazo.
  async function quitarCarga(carga) {
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.delete(`/notas/${id}/cargas/${carga.id}`);
      await cargarDatos();
      return true;
    } catch (err) {
      fallaAccion(err);
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

  // Máquinas por carga, incluidas las ya soltadas: la viva muestra su estado; la
  // que ya cumplió queda "terminado", sin botones.
  const cargasMaquinas = (() => {
    // Asignar no aparta: si otra nota ya la inició, se avisa y se ofrece cambiarla.
    const usadaPorOtra = (maquinaId) => {
      const m = todasMaquinas.find(x => String(x.id) === String(maquinaId));
      if (!m || m.estado !== 'en_uso' || !m.en_uso_nota_id) return null;
      return String(m.en_uso_nota_id) === String(id) ? null : (m.en_uso_folio ?? 'otra nota');
    };
    // Una línea por vuelta (un relavado repite la máquina). Solo la `actual` tiene
    // botones; las anteriores son historial.
    return cargasNota
      .map(c => {
        // Las fichas de más son de la carga: se enseñan en su última secadora.
        const usadas = c.maquinas_usadas ?? [];
        const ultimaSecadora = [...usadas].reverse().find(u => u.slot === 'secadora');
        return {
          id: c.id,
          orden: c.orden,
          maquinas: usadas.map(u => {
            const esLav = u.slot === 'lavadora';
            return {
              // Sin maquina_id la máquina se borró: queda el nombre, sin acciones.
              id: u.maquina_id,
              // Identifica la vuelta, no la máquina (puede repetirse).
              pasadaId: u.id,
              actual: Boolean(u.actual),
              // Hueco de la vuelta, para saber si quedó libre.
              slot: u.slot,
              nombre: u.nombre,
              tipo: u.tipo,
              // Programas del modelo: si se pregunta cuál al iniciar.
              modelo_tiempos: u.modelo_tiempos ?? null,
              // Con cronómetro, encender ya arranca la carga y se finaliza a mano.
              cronometro: Boolean(u.cronometro),
              // Cronómetro con un solo botón, "Iniciar", que da corriente y arranca.
              con_iniciar: Boolean(u.con_iniciar),
              // Solo fichas: sin Sonoff ni tope; Iniciar solo arranca el cronómetro.
              solo_fichas: Boolean(u.solo_fichas),
              ...(esLav ? {} : { tamano: u.tamano }),
              // La vuelta viva muestra el estado de su máquina; una cerrada, "terminado".
              estado: u.actual
                ? (esLav ? c.lavadora_estado : c.secadora_estado)
                : 'terminado',
              en_uso_desde: u.actual ? (esLav ? c.lavadora_en_uso_desde : c.secadora_en_uso_desde) : null,
              ciclo_minutos: u.actual ? (esLav ? c.lavadora_ciclo_minutos : c.secadora_ciclo_minutos) : null,
              // Programa elegido al iniciar: avisa cuándo terminó (el corte sigue en el tope).
              ciclo_elegido_minutos: u.actual
                ? (esLav ? c.lavadora_ciclo_elegido_minutos : c.secadora_ciclo_elegido_minutos) : null,
              esperandoArranque: Boolean(u.actual
                && (esLav ? c.lavadora_esperando_arranque : c.secadora_esperando_arranque)),
              tomadaPor: u.actual && u.maquina_id ? usadaPorOtra(u.maquina_id) : null,
              // Autoservicio: la lavadora cuya carga aún debe secar no cierra aquí; la ropa
              // pasa a la secadora desde la tarjeta de Máquinas.
              encadenaSecado: esLav && esAutoservicio
                && Boolean(c.secadora_tipo_previsto)
                && !c.secadora_id && !c.secadora_usada_id,
              // Autoservicio: la secadora que cobra por programa, aún sin precio.
              porDefinir: u.actual && !esLav && Boolean(c.secadora_por_definir),
              // Otra vuelta del mismo hueco (Por Encargo): Relavado o Más secado.
              repite: usadas.filter(x => x.slot === u.slot).indexOf(u) > 0,
              fichasExtra: u === ultimaSecadora ? Number(c.fichas_extra) || 0 : 0,
              precioFichasExtra: u === ultimaSecadora ? Number(c.precio_fichas_extra) || 0 : 0,
            };
          }),
        };
      })
      .filter(g => g.maquinas.length > 0);
  })();

  // Lista plana, para el encabezado y las acciones de la nota.
  const maquinasAsignadas = cargasMaquinas.flatMap(g => g.maquinas);

  // Máquina del modal, tomada de la lista viva (su vuelta actual): el modal pasa
  // solo de "Encender" a "Iniciar" al encenderse.
  const maqModal = maquinaModalId == null
    ? null
    : maquinasAsignadas.find(x => x.actual && String(x.id) === String(maquinaModalId)) ?? null;
  // El modelo que pregunta su programa lleva dos pasos: el tiempo se marca en la
  // pantalla de la máquina y luego se inicia; arrancar el cronómetro al dar
  // corriente contaría de más.
  const preguntaSuTiempo = preguntaTiempo(maqModal);
  // Con cronómetro se entra por "Encender", salvo las de botón "Iniciar".
  const pasoModal = maqModal?.cronometro && maqModal?.con_iniciar ? 'iniciar'
    : !maqModal?.cronometro && maqModal?.esperandoArranque ? 'iniciar' : 'encender';
  // Lo que se eligió al encender esta máquina.
  const minutosDeMaquina = (maq) => (maq ? minutosPorMaquina[maq.id] ?? null : null);

  // Cargas que se quedaron sin máquina, para asignarles una. En Por Encargo no
  // hay: los servicios no son máquinas por llenar.
  const notaCerrada = ['FINALIZADA', 'CANCELADA'].includes(nota?.estado);
  const cargasVacias = notaCerrada || esEncargo ? [] : cargasNota.filter(c =>
    !c.lavadora_id && !c.secadora_id && !c.lavadora_usada_id && !c.secadora_usada_id
    // Las de Por Encargo con tipo se asignan en su sección.
    && !c.lavadora_tipo_previsto && !c.secadora_tipo_previsto
  );

  // Huecos libres de una carga: solo los ocupa una máquina puesta (la misma ropa
  // puede necesitar otra vuelta). Un tipo previsto sin asignar tiene su renglón
  // propio y no se ofrece aquí.
  const previstoPendiente = (c, slot) => slot === 'lavadora'
    ? Boolean(c.lavadora_tipo_previsto) && !c.lavadora_id && !c.lavadora_usada_id
    : Boolean(c.secadora_tipo_previsto) && !c.secadora_id && !c.secadora_usada_id;
  // Relavado y Más secado (hueco ya usado) solo en Por Encargo.
  const huecosDeCarga = (c) => ({
    lavadora: Boolean(c) && !c.lavadora_id && !previstoPendiente(c, 'lavadora')
      && !(esAutoservicio && c.lavadora_usada_id),
    secadora: Boolean(c) && !c.secadora_id && !previstoPendiente(c, 'secadora')
      && !(esAutoservicio && c.secadora_usada_id),
  });

  // Se puede quitar si nunca arrancó, no es la única de la nota y el cobro no
  // está congelado (las mismas reglas del servidor).
  const puedeQuitarCarga = (c) =>
    Boolean(nota) && !notaCerrada && !cobroCongelado
    && cargasNota.length > 1
    && !c.lavadora_iniciada_at && !c.secadora_iniciada_at;

  // Lo que la carga le cobra a la nota (lo que deja de cobrarse al quitarla): en
  // Por Encargo, el precio del servicio + marca + ajuste; sin precio de servicio,
  // lo que de verdad cobra.
  const costoDeCarga = (c) => {
    const prods = (c?.productos ?? []).reduce((a, p) => a + Number(p.subtotal || 0), 0);
    if (c?.tope_carga != null) {
      const marca = (c?.productos ?? [])
        .filter(seVendePorUnidad)
        .reduce((a, p) => a + Number(p.subtotal || 0), 0);
      return Number(c.tope_carga) + marca + Number(c?.ajuste || 0);
    }
    return Number(c?.precio_lavadora || 0) + Number(c?.precio_secadora || 0)
      + Number(c?.precio_fichas_extra || 0) + Number(c?.ajuste || 0) + prods;
  };

  // Cargas a las que se puede sumar una máquina (p. ej. agregar la secadora).
  const cargasDestino = notaCerrada ? [] : cargasNota.filter(c => {
    const h = huecosDeCarga(c);
    return h.lavadora || h.secadora;
  });

  // La carga destino, en su versión recién cargada.
  const cargaDestino = asignarCarga
    ? (cargasNota.find(c => String(c.id) === String(asignarCarga.id)) ?? asignarCarga)
    : null;
  // ¿Ya cumplió su tiempo? Cada máquina por separado (como en el dashboard).
  const cicloCumplido = (m) => {
    if (m.estado !== 'en_uso' || !m.en_uso_desde) return false;
    if (!['LAVANDO', 'SECANDO'].includes(nota?.estado)) return false;
    // Ciclo sellado al arrancar o, si no hay, el de su tipo.
    const minutos = m.ciclo_minutos != null ? m.ciclo_minutos
                  : m.tipo === 'secadora'       ? tiempos.secadora
                  : m.tipo === 'lavadora_jumbo' ? tiempos.jumbo
                  : tiempos.mediana;
    return now - new Date(m.en_uso_desde).getTime() >= Math.max(0, Number(minutos) || 0) * 60000;
  };

  // ¿La de cronómetro ya pasó su tope?
  const topeAlcanzado = (m) => Boolean(m.cronometro && m.en_uso_desde && m.ciclo_minutos)
    && now - new Date(m.en_uso_desde).getTime() >= Number(m.ciclo_minutos) * 60000;

  // La máquina física si es secadora de fichas con Sonoff, o null (nunca se le
  // corta la luz).
  const deFichas = (m) => {
    const fisica = todasMaquinas.find(x => String(x.id) === String(m.id));
    return Number(fisica?.minutos_por_ficha) > 0 ? fisica : null;
  };

  // ¿Ya cumplió el programa elegido?
  const programaCumplido = (m) => Boolean(m.cronometro && m.en_uso_desde && m.ciclo_elegido_minutos)
    && now - new Date(m.en_uso_desde).getTime() >= Number(m.ciclo_elegido_minutos) * 60000;

  // "Más fichas" de la secadora de fichas (Sec49): desde que corre en esta nota,
  // suma el tiempo elegido al fin, sin tope.
  const minutosPorFicha = (m) => Number(deFichas(m)?.minutos_por_ficha) || 0;
  const puedeOtraFicha = (m) => {
    // Las fichas de más se cobran con el secado: solo secadoras.
    if (m.tipo !== 'secadora') return false;
    if (!m.actual || m.estado !== 'en_uso' || m.esperandoArranque || m.tomadaPor) return false;
    if (!m.cronometro || !m.en_uso_desde || !(Number(m.ciclo_elegido_minutos) > 0)) return false;
    const fisica = deFichas(m);
    return Boolean(fisica) && !fisica.solo_fichas && String(fisica.en_uso_nota_id) === String(nota?.id);
  };

  // Con `minutos`, uno de los tiempos del modelo (con su precio); sin él, una ficha.
  const meterOtraFicha = async (minutos = null) => {
    if (!confirmOtraFicha) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      const r = await api.patch(`/maquinas/${confirmOtraFicha.id}/otra-ficha`, {
        nota_id: nota?.id, ...(minutos != null && { minutos }),
      });
      if (r) {
        setConfirmOtraFicha(null);
        await cargarDatos();
      }
    } catch (err) {
      fallaAccion(err, err.message || 'No se pudieron meter más fichas.');
    } finally {
      setLoadingMaquina(false);
    }
  };

  // Lavadora y secadora se asignan desde que existe la nota (asignar no aparta).
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
  // Todo lo de una carga bajo un solo título: máquinas puestas, huecos por
  // asignar y el aviso de que no tiene ninguna.
  const bloquesCarga = cargasNota
    .map(c => ({
      carga: c,
      maquinas: cargasMaquinas.find(g => String(g.id) === String(c.id))?.maquinas ?? [],
      slots: slotsPorAsignar.filter(s => String(s.carga.id) === String(c.id)),
      vacia: cargasVacias.some(v => String(v.id) === String(c.id)),
    }))
    .filter(b => b.maquinas.length > 0 || b.slots.length > 0 || b.vacia);

  // Número del renglón: en Por Encargo, su lugar en esta pantalla (los servicios
  // vendidos no salen aquí); en los demás, su orden.
  const numeroDeCarga = (c) => {
    if (!esEncargo) return c?.orden;
    const i = bloquesCarga.findIndex(b => String(b.carga.id) === String(c?.id));
    return i >= 0 ? i + 1 : c?.orden;
  };

  // Máquinas libres para un hueco, sin las asignadas a otra nota abierta.
  const maquinasParaSlot = (slot) => todasMaquinas.filter(m => {
    if (m.estado !== 'disponible' || m.reservada) return false;
    if (slot === 'lavadora') {
      if (m.tipo === 'secadora') return false;
      // Cualquier lavadora libre: el tamaño no se filtra.
      return true;
    }
    // Cualquier secadora libre.
    return m.tipo === 'secadora';
  });

  // Lo que ofrece el modal: en modo hueco, ese hueco; si no, según el destino
  // (carga nueva = las dos).
  const huecosAsignar = asignarSlot
    ? { lavadora: asignarSlot.slot === 'lavadora', secadora: asignarSlot.slot === 'secadora' }
    : cargaDestino ? huecosDeCarga(cargaDestino) : { lavadora: true, secadora: true };
  const maquinasModal = asignarSlot
    ? maquinasParaSlot(asignarSlot.slot)
    // Todas las disponibles.
    : maquinasDisp;
  // La última máquina que usó la carga en ese hueco: se sugiere primero para la
  // vuelta siguiente (no se preselecciona).
  const ultimaUsadaEnSlot = (slot) => {
    const usadas = (cargaDestino?.maquinas_usadas ?? []).filter(u => u.slot === slot);
    return usadas.length ? usadas[usadas.length - 1].maquina_id : null;
  };
  // La pone al principio sin alterar el orden de las demás.
  const sugiriendoPrimero = (lista, maquinaId) => {
    if (!maquinaId) return lista;
    const i = lista.findIndex(m => String(m.id) === String(maquinaId));
    return i <= 0 ? lista : [lista[i], ...lista.slice(0, i), ...lista.slice(i + 1)];
  };
  const idUltimaLav = ultimaUsadaEnSlot('lavadora');
  const idUltimaSec = ultimaUsadaEnSlot('secadora');

  // Solo las que caben en el destino.
  const lavadorasDisp = huecosAsignar.lavadora
    ? sugiriendoPrimero(maquinasModal.filter(m => m.tipo !== 'secadora'), idUltimaLav) : [];
  const secadorasDisp = huecosAsignar.secadora
    ? sugiriendoPrimero(maquinasModal.filter(m => m.tipo === 'secadora'), idUltimaSec) : [];

  // ¿Por qué la nota NO pasa a "Por Entregar" al cerrar esta máquina? Devuelve el
  // motivo o null. El orden importa: una máquina que otra nota tomó se ve "en
  // uso", pero esa carga no ha arrancado.
  const motivoEnProceso = (maq) => {
    // Las demás máquinas, por máquina (no por vuelta) para no contarse a sí misma.
    const otras = maquinasAsignadas.filter(m => String(m.id) !== String(maq.id));
    const tomada = otras.find(m => m.actual && m.tomadaPor);
    if (tomada) {
      return `: la nota ${tomada.tomadaPor} se quedó con ${tomada.nombre}, así que esa carga todavía no arranca.`;
    }
    if (otras.some(m => m.estado === 'en_uso' && !m.tomadaPor)) {
      return ': sus demás cargas todavía están en máquina.';
    }
    // Trabajo pendiente: máquinas pedidas sin poner y puestas sin arrancar.
    const pendiente = slotsPorAsignar.length > 0
      || otras.some(m => m.actual && m.estado !== 'terminado'
           // Corriendo = en uso con cronómetro; esperando arranque o detenida cuenta como pendiente.
           && (m.estado !== 'en_uso' || m.esperandoArranque));
    return pendiente ? ': le queda otra máquina por asignar o por arrancar.' : null;
  };
  const motivoTerminar = confirmTerminarMaq ? motivoEnProceso(confirmTerminarMaq) : null;
  // Estado al cerrar la última máquina (como estadoAlTerminarCargas del servidor).
  const estadoAlCerrar = esAutoservicio && nota?.estado_pago === 'PAGADO'
    ? 'Finalizada'
    : etiquetaEstadoLista(nota?.tipo_servicio);

  // En el orden del servidor: lo recién agregado queda abajo.
  const productosNota  = nota?.productos ?? [];
  // Por Encargo: el granel y las bolsas del servicio van dentro de su precio (como
  // el total); marca, polvo y las bolsas de más se cobran.
  const cobradoProducto = (p) => (esEncargo ? cobroAparteEncargo(nota, p) : Number(p.subtotal || 0));
  const incluidoEnServicio = (p) => esEncargo && cobradoProducto(p) === 0;
  // De las bolsas de la nota, las que van en el servicio (si se cobran las de más).
  const incluidasDe = (p) => (esEncargo && p.clase === 'bolsa' && !nota?.bolsas_todas_incluidas
    ? Math.min(Number(p.cantidad), bolsasIncluidas(nota, p.producto_id)) : 0);
  const totalProductosNota = productosNota.reduce((a, x) => a + cobradoProducto(x), 0);
  // Con la nota cerrada o el cobro congelado no se tocan productos.
  const puedeTocarProductos = Boolean(nota) && !cobroCongelado
    && !['PAGADA', 'FINALIZADA', 'CANCELADA'].includes(nota.estado);

  // Existencia en las piezas con que se sirve: medidas (granel), unidades (marca)
  // o piezas (bolsas). Viene en medidas.
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
      : seVendePorUnidad(p) ? ['pieza', 'piezas']
      : ['botella', 'botellas'];
    const precio = porMedida(p) || p.clase === 'bolsa'
      ? Number(p.precio_unitario) || 0
      : Number(p.precio_botella) || 0;
    return `${fmtMonto(precio)}/${uno} · ${plural(disp, uno, varios)}`;
  };

  return (
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-movil md:max-w-2xl mx-auto space-y-6">

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
        {/* Mismo tamaño que la cabecera del Detalle de nota. */}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 leading-tight truncate">Salidas</h1>
          <p className="text-sm text-gray-500 leading-tight truncate">{nota?.folio ?? `Nota #${id}`}</p>
        </div>
      </div>

      {/* Caja cerrada: solo se puede terminar lo que quedó corriendo. */}
      {cajaAbierta === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">La caja está cerrada</p>
          <p className="mt-0.5 text-sm text-amber-800">
            Ábrela para agregar o encender máquinas y cambiar productos. Finalizar y detener sí se pueden.
          </p>
          <button
            type="button"
            onClick={() => setModalCajaOpen(true)}
            className="mt-2.5 text-sm font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-4 py-2 hover:bg-amber-100 transition-colors"
          >
            Abrir caja
          </button>
        </div>
      )}
      <AbrirCajaModal
        open={modalCajaOpen}
        onClose={() => setModalCajaOpen(false)}
        onAbierta={() => { setModalCajaOpen(false); setCajaAbierta(true); }}
      />

      {errorAccion && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {errorAccion}
        </div>
      )}

      {/* Cobro en un corte cerrado: se avisa de entrada que no se puede cambiar el total. */}
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
          {/* Agregar una máquina extra, salvo en notas cerradas. En Autoservicio entra
              como un renglón nuevo con su tarifa; las de una carga se asignan con su botón. */}
          {nota && !cobroCongelado
            && !['FINALIZADA', 'CANCELADA'].includes(nota.estado)
            && (esAutoservicio || cargasDestino.length > 0) && (
            <button
              onClick={() => iniciarAsignar()}
              disabled={loadingMaquina}
              className="flex items-center gap-1 text-sm font-medium text-blue hover:underline disabled:opacity-60"
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
            // Sin máquinas, huecos ni cargas vacías: nada que enseñar.
            <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
          )}

          {bloquesCarga.map(({ carga, maquinas, slots, vacia }) => (
            <div key={carga.id} className="space-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-gray-100 [&:not(:first-child)]:pt-4">
              {carga.orden != null && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-500">
                    {/* Cada renglón es una máquina, como en la captura y el ticket. */}
                    {/* Sin el tamaño de la carga: aquí se administran máquinas y cualquiera sirve. */}
                    {Renglon} {numeroDeCarga(carga)}
                  </p>
                  {/* Quitar la agregada de más: sin arrancar, no la única y sin cobro congelado. */}
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
                // Lavadora con temporizador que ya cumplió: verde y sin botón (el secado va
                // aparte). Con cronómetro corre hasta finalizarla.
                const lavadoTerminado = m.estado === 'en_uso' && m.tipo !== 'secadora'
                  && !m.cronometro && cicloCumplido(m);
                const cfg = lavadoTerminado ? BADGE_MAQUINA_ESTADO.terminado : BADGE_MAQUINA_ESTADO[m.estado];
                // "Marca · Tamaño" (LG · Mediana): la marca sale del catálogo vivo; si la
                // máquina ya no está, solo el tamaño.
                const fisica = todasMaquinas.find(x => String(x.id) === String(m.id));
                const tipoLabel = marcaYTamano({
                  ...m, marca: fisica?.marca, tamano: fisica?.tamano ?? m.tamano,
                });
                return (
                  <div key={m.pasadaId ?? i} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {/* Estado: solo el punto de color. */}
                      {cfg && (
                        <span
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' && !lavadoTerminado ? 'animate-pulse' : ''}`}
                          title={cfg.label}
                        />
                      )}
                      <span className="text-sm font-medium text-gray-800">{m.nombre}</span>
                      {tipoLabel && (
                        <span className="text-sm text-gray-500">— {tipoLabel}</span>
                      )}
                      {m.repite && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-light-blue text-blue">
                          {m.tipo === 'secadora' ? 'Más secado' : 'Relavado'}
                        </span>
                      )}
                      {/* Fichas de más que se le metieron (en Por Encargo no se cobran). */}
                      {m.fichasExtra > 0 && (
                        <span className="text-sm font-medium text-blue basis-full">
                          {m.fichasExtra === 1 ? '+1 ficha extra' : `+${m.fichasExtra} fichas extra`}
                          {m.precioFichasExtra > 0 && ` · ${fmtMonto(m.precioFichasExtra)}`}
                        </span>
                      )}
                      {m.tomadaPor && (
                        <span className="text-sm font-medium text-amber-700 basis-full">
                          La está usando la nota {m.tomadaPor}. Cámbiala por otra para poder iniciar.
                        </span>
                      )}
                      {m.esperandoArranque && (
                        <span className="text-sm font-medium text-green-700 basis-full">
                          Encendida. Carga la ropa, arráncala y dale a Iniciar.
                        </span>
                      )}
                      {m.cronometro && m.estado === 'en_uso' && !m.esperandoArranque && !m.tomadaPor && (
                        // Pasó su tope: falta finalizarla (como en la tarjeta de Máquinas).
                        topeAlcanzado(m) && !deFichas(m) ? (
                          <span className="text-sm font-medium text-red-600 basis-full">
                            Llegó al tope: se finaliza sola en unos segundos.
                          </span>
                        ) : programaCumplido(m) && deFichas(m) ? (
                          // Secadora de fichas: se acabó su tiempo; si le cabe, Otro ciclo.
                          <span className="text-sm font-medium text-amber-600 basis-full">
                            {puedeOtraFicha(m)
                              ? 'Se le acabó el tiempo. Dale más fichas o finalízala.'
                              : 'Se le acabó el tiempo. Finalízala.'}
                          </span>
                        ) : programaCumplido(m) ? (
                          <span className="text-sm font-medium text-amber-600 basis-full">
                            Terminó su programa de {m.ciclo_elegido_minutos} min. Finalízala.
                          </span>
                        ) : (
                          <span className="text-sm font-medium text-green-700 basis-full">
                            {/* Botón Iniciar (Speed Queen, Sec49): mensaje corto. */}
                            {m.solo_fichas
                              ? 'Corriendo. Finalízala cuando termine.'
                              : m.con_iniciar
                              ? 'Encendida. Finalízala cuando termine.'
                              : 'Encendida. Arráncala con su botón y finalízala cuando termine.'}
                          </span>
                        )
                      )}
                    </div>
                    {/* Otra nota la inició: solo se puede cambiar por una libre. */}
                    {m.tomadaPor ? (
                      <button
                        onClick={() => iniciarCambiar(m)}
                        disabled={loadingMaquina}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Cambiar máquina
                      </button>
                    ) : (<>
                    {/* Acciones en dos pasos: "Encender" da corriente para cargar la ropa e
                        "Iniciar" arranca el cronómetro cuando ya giró. */}
                    {/* Speed Queen y Sec49 no llevan "Encender": su "Iniciar" da corriente y arranca. */}
                    {(m.estado === 'disponible' || m.esperandoArranque) && (
                    <div className="flex items-center gap-2">
                    {m.estado === 'disponible' && !(m.cronometro && m.con_iniciar) && (
                      <button
                        onClick={() => encenderDesdeModal(m)}
                        disabled={loadingMaquina || Boolean(encendiendo)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Encender máquina
                      </button>
                    )}
                    {(m.esperandoArranque
                      || (m.estado === 'disponible' && m.cronometro && m.con_iniciar)) && (
                      <button
                        onClick={() => iniciarMaquina(m)}
                        disabled={loadingMaquina}
                        className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {m.tipo === 'secadora' ? 'Iniciar Secado' : 'Iniciar Lavado'}
                      </button>
                    )}
                    {/* Cambiarla por otra, mientras no tenga corriente. */}
                    {m.estado === 'disponible' && !m.esperandoArranque && (
                      <button
                        onClick={() => iniciarCambiar(m)}
                        disabled={loadingMaquina}
                        aria-label="Cambiar máquina"
                        title="Cambiar máquina"
                        className="w-9 h-9 flex items-center justify-center border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                      </button>
                    )}
                    </div>
                    )}
                    {m.estado === 'en_uso' && !m.esperandoArranque && (
                      (m.cronometro || cicloCumplido(m)) ? (
                        // Ya cumplió: cerrar su carga, salvo la lavadora que encadena secado
                        // (Autoservicio), que pasa a la secadora desde la tarjeta de Máquinas.
                        !m.encadenaSecado ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => setConfirmTerminarMaq(m)}
                              disabled={loadingMaquina}
                              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Finalizar Carga
                            </button>
                            {/* Secadora de fichas: desde que corre, más fichas suman tiempo (sin tope). */}
                            {puedeOtraFicha(m) && (
                              <button
                                onClick={() => { setErrorAccion(''); setConfirmOtraFicha(m); }}
                                disabled={loadingMaquina}
                                className="px-4 py-2 bg-white border border-blue text-blue hover:bg-light-blue disabled:opacity-60 text-sm font-medium rounded-lg transition-colors"
                              >
                                Más fichas
                              </button>
                            )}
                          </div>
                        ) : null
                      ) : (
                        // Lavadora: solo admin; secadora: cualquiera (ver MOSTRAR_DETENER_CICLO).
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
                    </>)}
                  </div>
                );
              })}

              {/* Huecos con tipo y sin máquina: se elige una libre. */}
              {slots.length > 0 && (<>
                {/* Lavadora y secadora se separan por aire y por el texto del botón, para no
                    asignar la equivocada; la línea separa cargas. */}
                <div>
                  {slots.map(({ slot, carga: cargaSlot }) => {
                    const opciones = maquinasParaSlot(slot);
                    // El tamaño solo se nombra en el edredón.
                    const queFalta = slot !== 'lavadora' ? 'secadoras' : 'lavadoras';
                    const esLavadora = slot === 'lavadora';
                    // El "Edredón" de Autoservicio: ya cobrado, espera cualquier lavadora libre.
                    const edredonAuto = esLavadora && esAutoservicio && esEdredonCarga(cargaSlot);
                    return (
                      <div key={slot} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        {/* Solo "Lavadora": cualquiera sirve. */}
                        <span className="text-sm font-medium text-gray-700">
                          {edredonAuto ? 'Edredón' : esLavadora ? 'Lavadora' : 'Secadora'}
                        </span>
                        {opciones.length === 0 ? (
                          <span className="text-sm text-red-600">No hay {queFalta} disponibles</span>
                        ) : (
                          // Abre el modal fijado a esta carga y a su tipo. El botón dice qué asigna,
                          // abreviado para que quepa hasta en 320 px.
                          <button
                            onClick={() => iniciarAsignarSlot(carga, slot)}
                            disabled={loadingMaquina}
                            className="w-full min-[360px]:w-auto px-4 py-3 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                          >
                            {edredonAuto ? 'Asignar' : esLavadora ? 'Asignar Lav.' : 'Asignar Sec.'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>)}

              {/* Carga sin máquina: para asignarle una. */}
              {vacia && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-gray-400 italic">Sin máquina asignada</span>
                  <div className="flex items-center gap-2">
                    {/* Quitar, en el encabezado: cualquiera que no haya arrancado. */}
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

          {/* Sin cargas no se lista nada: en Por Encargo la primera máquina se agrega
              con "+ Agregar". */}
        </div>
      </div>

      {/* Granel de cada servicio Por Encargo: sin elegirlo no arranca la lavadora.
          Se esconde si la nota no lleva granel. */}
      <GranelPorServicio nota={nota} puedeEditar={puedeTocarProductos} onCambio={cargarDatos} />

      {/* Sección 2 — Productos: también se agregan aquí; el admin puede quitar uno. */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
          {puedeTocarProductos && (
            <button
              onClick={iniciarAgregarProducto}
              disabled={loadingProducto != null}
              className="flex items-center gap-1 text-sm font-medium text-blue hover:underline disabled:opacity-60"
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
            {/* Mismo renglón que en Nueva Nota: nombre y precio arriba; cantidad, importe
                y borrar abajo. */}
            {productosNota.map(p => (
              <div key={p.producto_id} className="flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4">
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-sm font-semibold text-gray-900">{etiquetaProducto(p)}</p>
                  <p className="text-sm text-gray-500 tabular-nums">
                    {fmtMonto(p.precio_unitario)}/{unidadDeRenglon(p)}
                    {incluidoEnServicio(p)
                      ? <span className="text-gray-400"> · va dentro del servicio</span>
                      : incluidasDe(p) > 0 && (
                        <span className="text-gray-400">
                          {` · ${incluidasDe(p)} ${incluidasDe(p) === 1 ? 'incluida' : 'incluidas'} en el servicio`}
                        </span>
                      )}
                  </p>
                </div>

                <div className="flex flex-1 items-center justify-between gap-2">
                  {/* Servir más o menos; el − se detiene en 1 (quitar es el bote, de admin). */}
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
                    {incluidoEnServicio(p) ? (
                      <span className="w-16 text-right text-base font-bold text-green-700">Incluido</span>
                    ) : (
                      <span className="w-16 text-right text-base font-bold text-blue-700 tabular-nums">
                        {fmtMonto(cobradoProducto(p))}
                      </span>
                    )}
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
            {/* Suma de los productos; el total de la nota está en el detalle. */}
            <div className="px-4 py-3 bg-gray-50 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total productos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalProductosNota)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal agregar producto: la misma lista del alta, con precio y existencia.
          Entra con 1 y se sube con el +. */}
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
                <p className="text-sm text-gray-500 mt-0.5">
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
                // Los que ya lleva no se ofrecen: se sube la cantidad del renglón.
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
                            <p className="text-sm text-gray-500 tabular-nums">{detalleProducto(p)}</p>
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
          /* Lo incluido en el servicio no mueve el total. */
          detalle={incluidoEnServicio(confirmQuitarProd) ? [] : [
            { etiqueta: 'Deja de cobrarse', valor: fmtMonto(cobradoProducto(confirmQuitarProd)) },
            { etiqueta: 'Nuevo total de la nota',
              valor: fmtMonto(Number(nota?.precio_total || 0) - cobradoProducto(confirmQuitarProd)) },
          ]}
          textoConfirmar={loadingProducto === confirmQuitarProd.producto_id ? 'Quitando…' : 'Quitar producto'}
          procesando={loadingProducto === confirmQuitarProd.producto_id}
          error={errorAccion}
          onClose={() => setConfirmQuitarProd(null)}
          onConfirm={() => eliminarProducto(confirmQuitarProd.producto_id)}
        />
      )}

      {/* Quitar una carga: dice cuánto deja de cobrarse. */}
      {confirmQuitarCarga && (() => {
        // La versión recién cargada: el importe pudo cambiar con el modal abierto.
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
      {/* Elegir el programa; va antes de la animación. */}
      {eligiendoTiempo && !iniciando && !encendiendo && (
        <ElegirTiempoModal
          maquina={eligiendoTiempo.maquina}
          tiempos={tiemposDeMaquina(eligiendoTiempo.maquina)}
          /* Autoservicio, secadora por definir: cada programa con el precio que tomará la carga. */
          etiqueta={etiquetaPrograma(eligiendoTiempo.maquina, esAutoservicio && eligiendoTiempo.maquina.porDefinir)}
          guardando={loadingMaquina}
          error={errorAccion}
          onElegir={elegirTiempo}
          onCancelar={() => { setEligiendoTiempo(null); setErrorAccion(''); }}
        />
      )}

      {/* Más fichas: los tiempos del modelo, cada uno con su costo en Autoservicio. */}
      {confirmOtraFicha && preguntaTiempo(confirmOtraFicha) && (
        <ElegirTiempoModal
          maquina={confirmOtraFicha}
          tiempos={tiemposDeMaquina(confirmOtraFicha)}
          titulo="¿Cuánto tiempo más?"
          descripcion={esAutoservicio
            ? 'Se suma a lo que le queda y se cobra en la nota.'
            : 'Se suma a lo que le queda.'}
          etiqueta={etiquetaPrograma(confirmOtraFicha, esAutoservicio)}
          guardando={loadingMaquina}
          error={errorAccion}
          onElegir={(min) => meterOtraFicha(min)}
          onCancelar={() => { setConfirmOtraFicha(null); setErrorAccion(''); }}
        />
      )}

      {/* Sin tiempos en el modelo: una ficha. */}
      {confirmOtraFicha && !preguntaTiempo(confirmOtraFicha) && (() => {
        const m = confirmOtraFicha;
        const porFicha = minutosPorFicha(m);
        // Se cobra solo en Autoservicio (en Por Encargo el secado va en el servicio).
        const costo = nota?.tipo_servicio === 'AUTOSERVICIO' ? Number(deFichas(m)?.precio_por_ficha) || 0 : 0;
        return (
          <ConfirmacionModal
            tono="aviso"
            titulo={`Otra ficha a ${m.nombre}`}
            mensaje={`Se le suman ${porFicha} min.`}
            textoConfirmar={loadingMaquina ? 'Metiendo…' : 'Meter otra ficha'}
            procesando={loadingMaquina}
            error={errorAccion}
            onClose={() => { setConfirmOtraFicha(null); setErrorAccion(''); }}
            onConfirm={() => meterOtraFicha()}
          >
            {/* Lo que se suma a la nota, en una pastilla y no como fila. */}
            {costo > 0 && (
              <div className="flex justify-center mb-4">
                <span className="inline-flex items-baseline gap-2 rounded-full bg-amber-50 border border-amber-200 px-4 py-2 text-base text-amber-800">
                  Costo de ficha <span className="font-bold">+{fmtMonto(costo)}</span>
                </span>
              </div>
            )}
          </ConfirmacionModal>
        );
      })()}

      {encendiendo && <MaquinaCicloOverlay modo="encender" tipo={encendiendo.tipo} nombre={encendiendo.nombre} />}
      {iniciando && <MaquinaCicloOverlay modo="iniciar" tipo={iniciando.tipo} nombre={iniciando.nombre} />}
      {deteniendo && <MaquinaCicloOverlay modo="detener" tipo={deteniendo.tipo} nombre={deteniendo.nombre} />}

      {/* Modal de arranque: encender e iniciar en la misma ventana. Se esconde
          durante la animación y vuelve con el paso siguiente. */}
      {maqModal && !encendiendo && !iniciando && (() => {
        const esSecadora = maqModal.tipo === 'secadora';
        const esIniciar  = pasoModal === 'iniciar';
        const accion     = esSecadora ? 'secado' : 'lavado';
        // Minutos elegidos para esta vuelta.
        const minElegidos = minutosDeMaquina(maqModal);
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-modal overflow-y-auto p-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                {esIniciar ? (
                  /* Ícono de "play" */
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
              /* Speed Queen y Sec49: "Iniciar" da corriente y arranca; la Sec49 pregunta antes su programa. */
              maqModal.solo_fichas ? (
                /* Solo fichas: la app no la enciende; solo cuenta. */
                <p className="text-sm text-gray-500">
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span> trabaja con
                  fichas: arráncala con su ficha y aquí solo empieza a correr el cronómetro. Cuando
                  termine, finalízala.
                </p>
              ) : preguntaSuTiempo && maqModal.cronometro ? (
                <p className="text-sm text-gray-500">
                  En el paso siguiente eliges el programa de{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>: al elegirlo se
                  le da corriente y empieza el cronómetro, que te avisa cuando lo cumpla. Arráncala con
                  su botón con ese programa. La luz se le corta hasta su tope.
                </p>
              ) : preguntaSuTiempo ? (
                <p className="text-sm text-gray-500">
                  ¿Ya está girando{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>? Desde aquí
                  empiezan a correr{' '}
                  {minElegidos != null
                    ? <>los <span className="font-semibold text-gray-800">{minElegidos} min</span> que elegiste</>
                    : 'los minutos del ciclo'}, así que confírmalo solo cuando ya la hayas
                  arrancado con su botón.
                </p>
              ) : maqModal.cronometro ? (
                /* Cronómetro con botón Iniciar (Speed Queen). */
                <p className="text-sm text-gray-500">
                  Se le da corriente a{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span> y empieza a
                  correr el cronómetro. Carga la ropa y arráncala con su botón; cuando termine,
                  finalízala desde su tarjeta: ahí se le corta la luz.
                </p>
              ) : (
                <p className="text-sm text-gray-500">
                  ¿Iniciar el {accion} de{' '}
                  <span className="font-semibold text-gray-800">{maqModal.nombre}</span>? Desde aquí
                  empieza a correr el tiempo del ciclo, así que hazlo cuando ya la hayas arrancado con su
                  botón: lo que tardes de más se le descuenta al {accion}.
                </p>
              )
            ) : maqModal.cronometro && !maqModal.con_iniciar ? (
              /* Cronómetro: no hay segundo paso. */
              <p className="text-sm text-gray-500">
                Se le da corriente a{' '}
                <span className="font-semibold text-gray-800">{maqModal.nombre}</span> y empieza a
                correr el cronómetro. Carga la ropa y arráncala; cuando termine, finalízala desde su
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

            {/* Cambiar esta máquina, solo mientras no tenga corriente. */}
            {!maqModal.esperandoArranque && (
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

            {/* La acción del paso (destacada) y cancelar, a ancho completo. */}
            <div className="space-y-2.5">
              {esIniciar ? (
                <button
                  type="button"
                  onClick={() => iniciarMaquina()}
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
                  onClick={() => encenderDesdeModal()}
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
                  // "Marca · Tamaño", como al agregar máquina.
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
                          <span className="text-sm font-medium text-amber-600">
                            Reservada{m.reservada_folio ? ` (${m.reservada_folio})` : ''}
                          </span>
                        )}
                        {tamanoLabel && (
                          <span className="text-sm text-gray-500">{tamanoLabel}</span>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Terminar ciclo</h3>
            <p className="text-sm text-gray-500">
              ¿Confirmar que la carga de <span className="font-semibold text-gray-800">{confirmTerminarMaq.nombre}</span> ya terminó?{' '}
              {confirmTerminarMaq.tipo === 'secadora' ? 'La secadora' : 'La lavadora'} pasará a disponible.
            </p>
            {/* A la nota le queda trabajo que no está corriendo (sin asignar, sin
                arrancar o tomada por otra nota): el motivo dice cuál. */}
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

      {/* Modal asignar máquina extra: la máquina y a qué carga va. */}
      {asignarOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          {/* Título y botones fijos; solo la lista se desplaza. */}
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col">
            <div className="px-6 pt-6 pb-3 flex-shrink-0">
              <h3 className="text-base font-bold text-gray-900">
                {/* Sin carga destino se agrega una máquina nueva a la nota. */}
                {cargaDestino
                  ? `Asignar máquina · ${Renglon} ${numeroDeCarga(cargaDestino)}`
                  : 'Agregar máquina'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {asignarSlot
                  ? <>Elige la <span className="font-medium text-gray-700">
                      {/* Cualquier lavadora libre. */}
                      {asignarSlot.slot === 'lavadora'
                        ? 'lavadora'
                        : 'secadora'}
                    </span> que le falta a la {Renglon} {numeroDeCarga(cargaDestino)}. Queda asignada; la inicias después con su botón.</>
                  : cargaDestino
                    ? <>La máquina se suma a la <span className="font-medium text-gray-700">{Renglon} {numeroDeCarga(cargaDestino)}</span> <span className="font-medium text-gray-700">sin cobro</span>: no cambia el total de la nota. Queda asignada; la inicias después con su botón.</>
                    : <>Entra como una <span className="font-medium text-gray-700">máquina más de la nota</span> y{' '}
                      {/* En Autoservicio la máquina se cobra; en Por Encargo no mueve el precio. */}
                      <span className="font-medium text-gray-700">
                        {esAutoservicio ? 'se cobra su tarifa' : 'no cambia el total de la nota'}
                      </span>. Queda asignada; la inicias después con su botón.</>}
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-1 space-y-4">
            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* A qué carga se suma, si el modal viene de "+ Agregar" y hay varias. */}
            {!asignarCargaFija && !porMaquinas && cargasDestino.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Dónde va</p>
                <div className="flex flex-wrap gap-2">
                  {cargasDestino.map(c => {
                    const h = huecosDeCarga(c);
                    // Qué admite: una carga que ya lavó y secó vuelve a admitir las dos.
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
                        <span className="text-sm text-gray-500">{admite}</span>
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
                {/* Lavadoras, si el destino tiene hueco de lavadora */}
                {huecosAsignar.lavadora && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Lavadoras</p>
                  {lavadorasDisp.length === 0 ? (
                    <p className="text-sm text-gray-400">No hay lavadoras disponibles.</p>
                  ) : (
                    lavadorasDisp.map(m => {
                      const selected = asignarMaqSel.includes(String(m.id));
                      // Asignada a otra nota abierta: se avisa.
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
                              <span className="text-sm font-medium text-amber-600">
                                También en {m.reservada_folio ?? 'otra nota'}
                              </span>
                            )}
                            {marcaYTamano(m) && (
                              <span className="text-sm text-gray-500">{marcaYTamano(m)}</span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                )}

                {/* Secadoras, si el destino tiene hueco de secadora */}
                {huecosAsignar.secadora && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Secadoras</p>
                  {secadorasDisp.length === 0 ? (
                    <p className="text-sm text-gray-400">No hay secadoras disponibles.</p>
                  ) : (
                    secadorasDisp.map(m => {
                      const selected = asignarMaqSel.includes(String(m.id));
                      // Asignada a otra nota abierta: se avisa.
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
                              <span className="text-sm font-medium text-amber-600">
                                También en {m.reservada_folio ?? 'otra nota'}
                              </span>
                            )}
                            {marcaYTamano(m) && (
                              <span className="text-sm text-gray-500">{marcaYTamano(m)}</span>
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
            </div>

            <div className="flex gap-3 px-6 pt-4 pb-6 flex-shrink-0 border-t border-gray-100">
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
