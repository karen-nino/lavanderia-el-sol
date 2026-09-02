import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { etiquetaProducto, tituloProducto, subtituloProducto, ordenProducto } from '../lib/formatoInventario';
import { guardarAvisoCobro } from '../lib/avisoCobro';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import MaquinaCicloOverlay from '../components/MaquinaCicloOverlay';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

const BADGE_MAQUINA_ESTADO = {
  // "disponible" aquí = máquina asignada a la carga pero sin iniciar (En espera): gris.
  disponible:    { label: 'En espera',     cls: 'bg-gray-100 text-gray-600',   dot: 'bg-gray-400'  },
  en_uso:        { label: 'En uso',        cls: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'  },
  // "terminado" = la máquina ya cumplió su parte y se desvinculó de la carga: verde.
  terminado:     { label: 'Terminó',       cls: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  // "removida" = estuvo asignada y se eliminó: gris tenue, línea tachada.
  removida:      { label: 'Eliminada',     cls: 'bg-gray-100 text-gray-400',   dot: 'bg-gray-300' },
  mantenimiento: { label: 'Mantenimiento', cls: 'bg-red-100 text-red-700',     dot: 'bg-red-500'   },
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

// Abreviatura del tamaño en la lista de máquinas: Mediana → M, Jumbo → J,
// Edredón → E. Otros valores se muestran tal cual.
const TAMANO_ABBR = { Mediana: 'M', Jumbo: 'J', Edredón: 'E' };

// Etiqueta de tamaño de una máquina: solo aplica a lavadoras (Mediana/Jumbo).
// La secadora es de un solo tamaño, así que no muestra tamaño (null).
const labelTamano = (m) =>
  m.tipo === 'secadora' ? null : MAQUINA_TIPO_LABEL[m.tipo];

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
  const [productos,        setProductos]        = useState([]);
  const [cantidades,       setCantidades]       = useState({});
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingMaquina,   setLoadingMaquina]   = useState(false);
  const [loadingProducto,  setLoadingProducto]  = useState(null); // id del producto en proceso
  // Producto pendiente de confirmar antes de agregarlo a la nota.
  const [confirmProducto,  setConfirmProducto]  = useState(null);
  // Producto de la nota pendiente de confirmar antes de quitarlo.
  const [confirmQuitarProd, setConfirmQuitarProd] = useState(null);
  const [errorAccion,      setErrorAccion]      = useState('');
  const [confirmDetener,   setConfirmDetener]   = useState(null); // máquina a detener
  const [confirmIniciar,   setConfirmIniciar]   = useState(null); // máquina a iniciar
  const [confirmQuitar,    setConfirmQuitar]    = useState(null); // máquina a eliminar de la nota
  const [iniciando,        setIniciando]        = useState(null); // máquina arrancando (animación)
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
  const [asignarCobrar,    setAsignarCobrar]    = useState(null); // true | false | null
  // Carga a la que se suma la máquina: una carga vacía, o una que ya tiene
  // lavadora y a la que se le agrega la secadora. null = carga nueva.
  const [asignarCarga,     setAsignarCarga]     = useState(null);
  // true cuando el modal se abrió desde una carga concreta: el destino ya está
  // decidido y no se ofrece el selector "Carga nueva / Carga N".
  const [asignarCargaFija, setAsignarCargaFija] = useState(false);

  // Cambiar una máquina asignada (sin iniciar) por otra del mismo tipo.
  const [cambiarMaq,       setCambiarMaq]       = useState(null); // máquina a cambiar
  const [cambiarSel,       setCambiarSel]       = useState('');

  // Terminar el secado de UNA secadora (si es la última, la nota pasa a Por Entregar)
  const [confirmTerminarSec, setConfirmTerminarSec] = useState(null); // máquina secadora

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
      const [notaData, productosData, ajustes, maquinasData] = await Promise.all([
        api.get(`/notas/${id}`),
        api.get('/productos'),
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
      setProductos(productosData);
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
  async function iniciarMaquina() {
    if (!confirmIniciar) return;
    const maq = confirmIniciar;
    setLoadingMaquina(true);
    setErrorAccion('');
    setIniciando(maq); // arranca la animación de lavadora
    try {
      // Duración mínima para que la animación (agua llenándose) se alcance a
      // ver aunque la API responda al instante.
      await Promise.all([
        api.patch(`/notas/${id}/activar-pendientes`, { maquina_id: maq.id }),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
      setConfirmIniciar(null);
      await cargarDatos();
    } catch (err) {
      // El modal de confirmación sigue abierto detrás; ahí se muestra el error.
      setErrorAccion(err.message);
    } finally {
      setIniciando(null);
      setLoadingMaquina(false);
    }
  }

  // Desde el modal de iniciar: abrir el selector para cambiar esta máquina.
  function cambiarDesdeModal() {
    const m = confirmIniciar;
    setConfirmIniciar(null);
    iniciarCambiar(m);
  }

  // Quita la máquina confirmada de la nota (desasignarla).
  async function quitarMaquina() {
    if (!confirmQuitar) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/quitar-maquina`, { maquina_id: confirmQuitar.id });
      setConfirmQuitar(null);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
      setConfirmQuitar(null);
    } finally {
      setLoadingMaquina(false);
    }
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

  // Abre el selector para asignar una máquina. Sin argumento crea una carga
  // nueva (máquina extra); con una carga vacía, llena esa carga.
  async function iniciarAsignar(carga = null) {
    setErrorAccion('');
    setAsignarMaqSel([]);
    // Autoservicio siempre cobra; Por Encargo lo elige el empleado.
    setAsignarCobrar(esAutoservicio ? true : null);
    setAsignarCarga(carga);
    setAsignarCargaFija(Boolean(carga));
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
    const esSec = (mid) => maquinasDisp.some(m => String(m.id) === String(mid) && m.tipo === 'secadora');
    setAsignarMaqSel(prev => {
      if (prev.includes(s)) return prev.filter(x => x !== s);
      if (asignarCarga) return [...prev.filter(x => esSec(x) !== esSec(s)), s];
      return [...prev, s];
    });
  }

  // Cambia el destino de la asignación (carga nueva o una carga existente) y
  // limpia la selección: los huecos disponibles cambian con el destino.
  function elegirDestino(carga) {
    setErrorAccion('');
    setAsignarCarga(carga);
    setAsignarMaqSel([]);
  }

  // Asigna las máquinas elegidas: el backend crea la(s) carga(s) nueva(s) (por
  // cobrar o sin cobro); las máquinas quedan asignadas (sin iniciar).
  async function confirmarAsignar() {
    const cobrar = esAutoservicio ? true : asignarCobrar;
    if (asignarMaqSel.length === 0 || cobrar === null) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/notas/${id}/asignar-maquina`, {
        maquina_ids: asignarMaqSel.map(Number),
        cobrar,
        ...(asignarCarga ? { carga_id: asignarCarga.id } : {}),
      });
      setAsignarOpen(false);
      setAsignarCarga(null);
      setAsignarCargaFija(false);
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

  // La cantidad arranca en 0 (nada elegido) y no pasa del stock disponible.
  const cantidadDe = (p) => Math.min(Number(cantidades[p.id]) || 0, disponibleDe(p));
  const setCantidad = (productoId, valor) =>
    setCantidades(prev => ({ ...prev, [productoId]: String(Math.max(0, valor)) }));

  async function agregarProducto(productoId) {
    const cantidad = Number(cantidades[productoId]);
    if (!cantidad || cantidad <= 0) return;
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.post(`/notas/${id}/productos`, { producto_id: productoId, cantidad });
      setCantidades(prev => ({ ...prev, [productoId]: '' }));
      setConfirmProducto(null);
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
      setConfirmQuitarProd(null);
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
  // mostrarlas bajo su encabezado "Carga N". Se incluyen también las máquinas ya
  // desvinculadas (usada): la que sigue viva muestra su estado (En espera / En
  // uso); la que ya cumplió su parte se queda como "terminado" (verde), sin botones.
  const cargasMaquinas = (() => {
    return cargasNota
      .map(c => ({
        orden: c.orden,
        maquinas: [
          (c.lavadora_id || c.lavadora_usada_id) && {
            id: c.lavadora_id || c.lavadora_usada_id,
            nombre: c.lavadora_id ? c.lavadora_nombre : c.lavadora_usada_nombre,
            tipo:   c.lavadora_id ? c.lavadora_tipo   : c.lavadora_usada_tipo,
            // Desvinculada y removida → eliminada (tachada); si no → terminó.
            estado: c.lavadora_id ? c.lavadora_estado : (c.lavadora_removida ? 'removida' : 'terminado'),
            en_uso_desde: c.lavadora_en_uso_desde,
          },
          (c.secadora_id || c.secadora_usada_id) && {
            id: c.secadora_id || c.secadora_usada_id,
            nombre: c.secadora_id ? c.secadora_nombre : c.secadora_usada_nombre,
            tipo:   c.secadora_id ? c.secadora_tipo   : c.secadora_usada_tipo,
            tamano: c.secadora_id ? c.secadora_tamano : c.secadora_usada_tamano,
            estado: c.secadora_id ? c.secadora_estado : (c.secadora_removida ? 'removida' : 'terminado'),
            en_uso_desde: c.secadora_en_uso_desde,
          },
        ].filter(Boolean),
      }))
      .filter(g => g.maquinas.length > 0);
  })();

  // Lista plana (para conteo del encabezado y validaciones de acciones a nivel nota).
  const maquinasAsignadas = cargasMaquinas.flatMap(g => g.maquinas);

  // Cargas que se eligieron al hacer la nota pero se quedaron sin máquina (ni
  // asignada ni ya usada). Se muestran para poder asignarles una rápidamente.
  const notaCerrada = ['FINALIZADA', 'CANCELADA'].includes(nota?.estado);
  const cargasVacias = notaCerrada ? [] : cargasNota.filter(c =>
    !c.lavadora_id && !c.secadora_id && !c.lavadora_usada_id && !c.secadora_usada_id
    // Las cargas de Por Encargo con TIPO previsto se asignan en su sección propia.
    && !c.lavadora_tipo_previsto && !c.secadora_tipo_previsto
  );

  // Huecos de una carga: una carga admite a lo más una lavadora y una secadora
  // (contando las que ya se usaron y se liberaron). El hueco de lavadora no se
  // ofrece si la carga tiene un TIPO previsto pendiente: ese se asigna en su
  // sección propia, con el tipo que se eligió al hacer la nota.
  const cargaTieneLav = (c) => Boolean(c.lavadora_id || c.lavadora_usada_id);
  const cargaTieneSec = (c) => Boolean(c.secadora_id || c.secadora_usada_id);
  const huecosDeCarga = (c) => ({
    lavadora: Boolean(c) && !cargaTieneLav(c) && !c.lavadora_tipo_previsto,
    secadora: Boolean(c) && !cargaTieneSec(c),
  });

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
  // Sin carga destino (carga nueva) caben lavadora y secadora.
  const huecosAsignar = cargaDestino ? huecosDeCarga(cargaDestino) : { lavadora: true, secadora: true };
  // Solo se ofrecen las máquinas que caben en el destino elegido.
  const lavadorasDisp = huecosAsignar.lavadora ? maquinasDisp.filter(m => m.tipo !== 'secadora') : [];
  const secadorasDisp = huecosAsignar.secadora ? maquinasDisp.filter(m => m.tipo === 'secadora') : [];

  // Slots de Por Encargo con TIPO elegido pero sin máquina física: se asignan
  // eligiendo una máquina disponible del tipo correspondiente.
  const TIPO_MAQ_LABEL = { mediana: 'Mediana', jumbo: 'Jumbo', edredon: 'Edredón' };
  // Solo se asigna la LAVADORA aquí; la secadora se elige después, al terminar
  // el lavado (así no se aparta la secadora desde el inicio).
  const slotsPorAsignar = notaCerrada ? [] : cargasNota.flatMap(c => {
    const out = [];
    if (c.lavadora_tipo_previsto && !c.lavadora_id && !c.lavadora_usada_id) {
      out.push({ carga: c, slot: 'lavadora', tipo: c.lavadora_tipo_previsto });
    }
    return out;
  });
  // Máquinas disponibles que coinciden con un slot (lavadora/secadora) y su tipo.
  // "Disponible" no basta: una máquina apartada por otra nota abierta (o por
  // otra carga de esta) sigue disponible hasta que la inician. El backend la
  // marca como `reservada` y rechaza asignarla; aquí se muestra deshabilitada
  // con su folio, para no ofrecer algo que va a fallar.
  const maquinasParaSlot = (slot, tipo) => todasMaquinas.filter(m => {
    if (m.estado !== 'disponible') return false;
    if (slot === 'lavadora') {
      return m.tipo === (tipo === 'jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana');
    }
    // La secadora es de un solo tamaño: cualquier secadora disponible sirve.
    return m.tipo === 'secadora';
  });

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

  const productosNota  = [...(nota?.productos || [])].sort((a, b) => ordenProducto(a) - ordenProducto(b));

  // El backend cobra según el servicio de la nota: Autoservicio vende la BOTELLA
  // entera y Por Encargo cobra por TAPA (utils/calculosNotas.js). La lista tiene
  // que mostrar esa misma unidad y ese mismo precio; si no, enseña el precio por
  // tapa y cobra el de botella.
  const porBotella = nota?.tipo_servicio === 'AUTOSERVICIO';
  const esBolsa    = (p) => p.clase === 'bolsa';

  const unidadDe = (p, n = 2) => {
    if (esBolsa(p))  return n === 1 ? 'bolsa' : 'bolsas';
    if (!porBotella) return n === 1 ? 'tapa'  : 'tapas';
    return p.tipo_liquido === 'marca'
      ? (n === 1 ? 'unidad'  : 'unidades')
      : (n === 1 ? 'botella' : 'botellas');
  };
  // El stock vive en tapas: una botella son varias.
  const tapasPorUnidadDe = (p) =>
    (esBolsa(p) || !porBotella) ? 1 : (Number(p.tapas_por_botella) || 1);
  const precioDe = (p) => Number(esBolsa(p) || !porBotella ? p.precio_unitario : p.precio_botella) || 0;
  const disponibleDe = (p) => Math.floor(Number(p.stock_disponible) / tapasPorUnidadDe(p));

  // Todo lo que tenga al menos una unidad vendible, incluido lo que ya está en
  // la nota: agregarlo otra vez le suma cantidad a su renglón.
  const productosDisponibles = productos
    .filter(p => disponibleDe(p) > 0)
    .sort((a, b) => ordenProducto(a) - ordenProducto(b));
  const enNotaDe = (p) => productosNota.find(x => String(x.producto_id) === String(p.id));
  const totalProductosNota = productosNota.reduce((a, x) => a + Number(x.subtotal || 0), 0);

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
          {/* Asignar una máquina extra: disponible desde el inicio, salvo en
              notas cerradas. */}
          {nota && !['FINALIZADA', 'CANCELADA'].includes(nota.estado) && (
            <button
              onClick={() => iniciarAsignar()}
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
                  // Lavadora que ya cumplió su ciclo (terminó el lavado): se
                  // muestra en verde y sin botón; el secado se inicia aparte
                  // desde la secadora de la carga.
                  const lavadoTerminado = m.estado === 'en_uso' && m.tipo !== 'secadora' && cicloCumplido(m);
                  const cfg = lavadoTerminado ? BADGE_MAQUINA_ESTADO.terminado : BADGE_MAQUINA_ESTADO[m.estado];
                  // La secadora muestra su tamaño (Mediana/Jumbo) igual que la
                  // lavadora; se muestra abreviado (M/J/E) en el renglón.
                  const tamanoLabel = labelTamano(m);
                  const tipoLabel = TAMANO_ABBR[tamanoLabel] ?? tamanoLabel;
                  // Máquina eliminada: línea tachada y en gris (estuvo asignada).
                  const removida = m.estado === 'removida';
                  return (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                      <div className={`flex flex-wrap items-center gap-2 min-w-0 ${removida ? 'line-through text-gray-400' : ''}`}>
                        {/* Estado: solo el punto de color */}
                        {cfg && (
                          <span
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot} ${m.estado === 'en_uso' && !lavadoTerminado ? 'animate-pulse' : ''}`}
                            title={cfg.label}
                          />
                        )}
                        <span className={`text-sm font-medium ${removida ? 'text-gray-400' : 'text-gray-800'}`}>{m.nombre}</span>
                        {tipoLabel && (
                          <span className="text-xs text-gray-500">— {tipoLabel}</span>
                        )}
                      </div>
                      {/* Acción por máquina: iniciar (cambiar/eliminar viven en el modal) */}
                      {m.estado === 'disponible' && (
                        <button
                          onClick={() => setConfirmIniciar(m)}
                          disabled={loadingMaquina}
                          className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {m.tipo === 'secadora' ? 'Iniciar Secado' : 'Iniciar Lavado'}
                        </button>
                      )}
                      {m.estado === 'en_uso' && (
                        cicloCumplido(m) ? (
                          // Secadora que terminó: finalizar la carga. Lavadora
                          // que terminó: sin botón (verde), el secado va aparte.
                          m.tipo === 'secadora' ? (
                            <button
                              onClick={() => setConfirmTerminarSec(m)}
                              disabled={loadingMaquina}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Finalizar Carga
                            </button>
                          ) : null
                        ) : (
                          // Solo un admin puede detener una LAVADORA; la secadora
                          // la puede detener cualquier usuario.
                          (m.tipo === 'secadora' || esAdmin) && (
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
                      {/* estado "terminado": ya cumplió su parte, sin acciones
                          (solo el punto verde a la izquierda lo indica). */}
                    </div>
                  );
                })}
              </div>
            ))
          ) : cargasVacias.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>
          ) : null}

          {/* Por Encargo: cargas con TIPO elegido, sin máquina física. Se
              asigna eligiendo una máquina disponible del tipo correspondiente. */}
          {slotsPorAsignar.map(({ carga, slot, tipo }) => {
            const opciones = maquinasParaSlot(slot, tipo);
            return (
              <div key={`slot-${carga.id}-${slot}`} className="space-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-gray-100 [&:not(:first-child)]:pt-4">
                <p className="text-xs font-semibold text-gray-500">Carga {carga.orden}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-gray-600">
                    {slot === 'lavadora' ? `Lavadora ${TIPO_MAQ_LABEL[tipo] ?? tipo}` : 'Secadora'}
                    <span className="text-gray-400 italic"> — sin asignar</span>
                  </span>
                  {opciones.length === 0 ? (
                    <span className="text-sm text-red-600">No hay {slot === 'lavadora' ? `lavadoras ${TIPO_MAQ_LABEL[tipo] ?? tipo}` : 'secadoras'} disponibles</span>
                  ) : (
                    <select
                      defaultValue=""
                      disabled={loadingMaquina}
                      onChange={e => asignarTipoCarga(carga.id, slot, e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:opacity-60"
                    >
                      <option value="" disabled>Asignar máquina…</option>
                      {opciones.map(m => (
                        <option key={m.id} value={m.id} disabled={Boolean(m.reservada)}>
                          {m.nombre}
                          {m.reservada ? ` — Reservada${m.reservada_folio ? ` (${m.reservada_folio})` : ''}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}

          {/* Cargas que se eligieron al hacer la nota pero se quedaron sin
              máquina: se muestran para asignarles una rápidamente. */}
          {cargasVacias.map(c => (
            <div key={`vacia-${c.id}`} className="space-y-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-gray-100 [&:not(:first-child)]:pt-4">
              <p className="text-xs font-semibold text-gray-500">Carga {c.orden}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-gray-400 italic">Sin máquina asignada</span>
                <button
                  onClick={() => iniciarAsignar(c)}
                  disabled={loadingMaquina}
                  className="px-4 py-2 bg-blue hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Asignar máquina
                </button>
              </div>
            </div>
          ))}

          {/* Una nota sin ninguna carga no lista nada aquí: para darle su
              primera máquina se usa "+ Asignar Máquina" del encabezado. */}
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
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{tituloProducto(p)}</p>
                  {subtituloProducto(p) && (
                    <p className="text-xs text-gray-400">{subtituloProducto(p)}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    Cant. {p.cantidad} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmQuitarProd(p)}
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
            {/* Suma de los productos. El total de la nota (máquinas, ajuste y
                todo lo demás) vive en el detalle, no en esta tarjeta. */}
            <div className="px-4 py-3 bg-gray-50 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total productos</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(totalProductosNota)}</span>
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
              : 'Sin existencias disponibles'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {productosDisponibles.map(p => (
              <div key={p.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-3">
                <div className="flex-1 min-w-[9rem]">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {tituloProducto(p)}
                    {enNotaDe(p) && (
                      <span className="ml-2 text-xs font-semibold text-blue bg-light-blue rounded-pill px-2 py-0.5 align-middle">
                        en la nota
                      </span>
                    )}
                  </p>
                  {/* "Granel" distingue el bidón de los productos de marca, que
                      se llaman igual (Suavizante vs. Ensueño · Suavizante). */}
                  {subtituloProducto(p) && (
                    <p className="text-xs text-gray-400">{subtituloProducto(p)}</p>
                  )}
                  <p className="text-xs font-medium text-gray-500">
                    {precioDe(p) > 0
                      ? `${fmtMonto(precioDe(p))}/${unidadDe(p, 1)}`
                      : <span className="text-bronce">sin precio</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-auto flex-shrink-0">
                  {/* Mismo control de cantidad que en los formularios de nota. */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCantidad(p.id, cantidadDe(p) - 1)}
                      disabled={cantidadDe(p) <= 0}
                      aria-label="Disminuir cantidad"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-gray-900 tabular-nums">
                      {cantidadDe(p)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCantidad(p.id, cantidadDe(p) + 1)}
                      disabled={cantidadDe(p) >= disponibleDe(p)}
                      aria-label="Aumentar cantidad"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmProducto({ ...p, cantidad: cantidadDe(p) })}
                    disabled={cantidadDe(p) <= 0 || loadingProducto === p.id}
                    className="px-3 py-2 bg-blue hover:opacity-90 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0"
                  >
                    {loadingProducto === p.id ? '...' : 'Agregar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Advertencia antes de quitar un producto de la nota */}
      {confirmQuitarProd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-red/10 text-red flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">Quitar producto</h3>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Se quitará{' '}
                <span className="font-semibold text-gray-800">
                  {confirmQuitarProd.cantidad} × {confirmQuitarProd.nombre}
                </span>{' '}
                de esta nota.
              </p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Deja de cobrarse</span>
                  <span className="font-semibold text-gray-900">{fmtMonto(confirmQuitarProd.subtotal)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Nuevo total de la nota</span>
                  <span className="font-semibold text-gray-900">
                    {fmtMonto(Number(nota?.precio_total || 0) - Number(confirmQuitarProd.subtotal || 0))}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                El producto vuelve al inventario. Si lo necesitas de nuevo, agrégalo abajo.
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmQuitarProd(null)}
                disabled={loadingProducto === confirmQuitarProd.producto_id}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => eliminarProducto(confirmQuitarProd.producto_id)}
                disabled={loadingProducto === confirmQuitarProd.producto_id}
                className="flex-1 bg-red hover:opacity-90 disabled:opacity-60 text-white font-medium py-3 rounded-lg text-base transition-colors"
              >
                {loadingProducto === confirmQuitarProd.producto_id ? 'Quitando...' : 'Quitar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advertencia antes de agregar un producto a la nota */}
      {confirmProducto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-bronce/15 text-bronce flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">
                {enNotaDe(confirmProducto) ? 'Agregar más producto' : 'Agregar producto'}
              </h3>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Se agregarán{' '}
                <span className="font-semibold text-gray-800">
                  {confirmProducto.cantidad} {unidadDe(confirmProducto, confirmProducto.cantidad)}
                </span>{' '}
                de <span className="font-semibold text-gray-800">{etiquetaProducto(confirmProducto)}</span>
                {enNotaDe(confirmProducto)
                  ? ` a las ${enNotaDe(confirmProducto).cantidad} que ya lleva esta nota.`
                  : ' a esta nota.'}
              </p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Se cobra al cliente</span>
                  <span className="font-semibold text-gray-900">
                    {fmtMonto(precioDe(confirmProducto) * confirmProducto.cantidad)}
                  </span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-gray-500">Queda en inventario</span>
                  <span className="font-semibold text-gray-900">
                    {disponibleDe(confirmProducto) - confirmProducto.cantidad}{' '}
                    {unidadDe(confirmProducto, disponibleDe(confirmProducto) - confirmProducto.cantidad)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Sale del inventario al confirmar. Si te equivocas, quita el producto de la nota para
                devolverlo.
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmProducto(null)}
                disabled={loadingProducto === confirmProducto.id}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => agregarProducto(confirmProducto.id)}
                disabled={loadingProducto === confirmProducto.id}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3 rounded-lg text-base transition-colors"
              >
                {loadingProducto === confirmProducto.id ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal advertencia iniciar lavado/secado */}
      {iniciando && <MaquinaCicloOverlay modo="iniciar" tipo={iniciando.tipo} nombre={iniciando.nombre} />}
      {deteniendo && <MaquinaCicloOverlay modo="detener" tipo={deteniendo.tipo} nombre={deteniendo.nombre} />}

      {confirmIniciar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                {/* Ícono de "play" (empezar) */}
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <h3 className="text-base font-bold text-gray-900">
                {confirmIniciar.tipo === 'secadora' ? 'Iniciar secado' : 'Iniciar lavado'}
              </h3>
            </div>
            <p className="text-sm text-gray-500">
              ¿Iniciar el {confirmIniciar.tipo === 'secadora' ? 'secado' : 'lavado'} de{' '}
              <span className="font-semibold text-gray-800">{confirmIniciar.nombre}</span>? La máquina
              arrancará su ciclo y quedará en uso. Asegúrate de que la carga ya está dentro.
            </p>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* Secundarias: cambiar o quitar esta máquina de la nota */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={cambiarDesdeModal}
                disabled={loadingMaquina}
                aria-label="Cambiar máquina"
                title="Cambiar máquina"
                className="flex items-center justify-center border border-gray-300 text-gray-700 py-2.5 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { const m = confirmIniciar; setConfirmIniciar(null); setConfirmQuitar(m); }}
                disabled={loadingMaquina}
                aria-label="Eliminar máquina"
                title="Eliminar máquina"
                className="flex items-center justify-center border border-red-200 text-red-600 py-2.5 rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                </svg>
              </button>
            </div>

            {/* Principales: iniciar (destacado) y cancelar, apiladas a ancho completo */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={iniciarMaquina}
                disabled={loadingMaquina}
                className="w-full bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Iniciando...' : 'Iniciar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmIniciar(null)}
                disabled={loadingMaquina}
                className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal advertencia: eliminar máquina de la nota */}
      {confirmQuitar && (
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
              <h3 className="text-base font-bold text-gray-900">Eliminar máquina</h3>
            </div>
            <p className="text-sm text-gray-500">
              ¿Quitar <span className="font-semibold text-gray-800">{confirmQuitar.nombre}</span> de esta nota?
              Dejará de estar asignada y su tarifa se descontará del total. Si su carga queda vacía, se elimina.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmQuitar(null)}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={quitarMaquina}
                disabled={loadingMaquina}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loadingMaquina ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  // Tamaño (Mediana/Jumbo) solo para lavadoras; la secadora no lo muestra.
                  const tamanoLabel = labelTamano(m);
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

      {/* Modal asignar máquina extra — máquina y, solo en Por Encargo, el cobro */}
      {asignarOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {cargaDestino ? `Asignar máquina · Carga ${cargaDestino.orden}` : 'Asignar máquina'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {cargaDestino
                  ? <>La máquina se suma a la <span className="font-medium text-gray-700">Carga {cargaDestino.orden}</span>. Queda asignada; la inicias después con su botón.</>
                  : <>Se abre una <span className="font-medium text-gray-700">carga nueva</span>. Puedes elegir varias: una lavadora y una secadora se agrupan en una misma carga. Quedan asignadas; las inicias después con su botón.</>}
              </p>
            </div>

            {errorAccion && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {errorAccion}
              </div>
            )}

            {/* ¿Carga nueva o se suma a una carga que ya existe? Solo se ofrece
                cuando el modal se abre desde "Asignar Máquina" (sin destino
                fijo) y hay alguna carga con hueco libre. */}
            {!asignarCargaFija && cargasDestino.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dónde va</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => elegirDestino(null)}
                    className={`px-4 py-2.5 border-2 rounded-xl text-sm font-medium transition-colors ${
                      cargaDestino === null ? 'border-blue bg-light-blue text-gray-800' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                    }`}
                  >
                    Carga nueva
                  </button>
                  {cargasDestino.map(c => {
                    const h = huecosDeCarga(c);
                    const falta = h.lavadora && h.secadora ? 'vacía'
                                : h.lavadora ? 'falta lavadora' : 'falta secadora';
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
                        <span className="text-sm font-medium text-gray-800">Carga {c.orden}</span>
                        <span className="text-xs text-gray-500">{falta}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ¿Se cobra lo que se está asignando? Solo se pregunta en Por
                Encargo: en Autoservicio todo se cobra. */}
            {!esAutoservicio && (
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
                      // Reservada por otra nota abierta: se muestra pero no se elige.
                      const reservada = Boolean(m.reservada);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={reservada}
                          onClick={() => toggleAsignarMaq(m.id)}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            reservada
                              ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                              : selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <SelCheck on={selected} />
                            <span className="font-medium text-gray-800 truncate">{m.nombre}</span>
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {reservada && <span className="text-xs font-medium text-amber-600">Reservada{m.reservada_folio ? ` (${m.reservada_folio})` : ''}</span>}
                            {labelTamano(m) && (
                              <span className="text-xs text-gray-500">{labelTamano(m)}</span>
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
                      // Reservada por otra nota abierta: se muestra pero no se elige.
                      const reservada = Boolean(m.reservada);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={reservada}
                          onClick={() => toggleAsignarMaq(m.id)}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                            reservada
                              ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                              : selected ? 'border-blue bg-light-blue' : 'border-gray-200 bg-white hover:border-blue-300'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <SelCheck on={selected} />
                            <span className="font-medium text-gray-800 truncate">{m.nombre}</span>
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {reservada && <span className="text-xs font-medium text-amber-600">Reservada{m.reservada_folio ? ` (${m.reservada_folio})` : ''}</span>}
                            {labelTamano(m) && (
                              <span className="text-xs text-gray-500">{labelTamano(m)}</span>
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
                onClick={() => { setAsignarOpen(false); setAsignarCarga(null); setAsignarCargaFija(false); }}
                disabled={loadingMaquina}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAsignar}
                disabled={loadingMaquina || asignarMaqSel.length === 0 || (!esAutoservicio && asignarCobrar === null)}
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
