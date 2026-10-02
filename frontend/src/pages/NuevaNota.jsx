import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { etiquetaProducto, ordenProducto, seVendePorUnidad, esPolvo } from '../lib/formatoInventario';
import { capitalizarNombre } from '../lib/texto';
import { FORMAS_PAGO } from '../lib/formasPago';
import AbrirCajaModal from '../components/AbrirCajaModal';
import ElegirMaquinasModal from '../components/ElegirMaquinasModal';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const LABEL_CLS = 'block text-sm font-semibold text-gray-900 mb-2';

// Línea divisoria entre secciones de una misma pantalla.
const Separador = () => (
  <div className="py-1"><div className="border-t border-gray-200" /></div>
);

const INPUT_DISABLED_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base bg-gray-50 text-gray-400 cursor-not-allowed placeholder:text-gray-400';

const TIPOS_SERVICIO = [
  { v: 'AUTOSERVICIO', label: 'Autoservicio' },
  { v: 'POR_ENCARGO',  label: 'Por Encargo'  },
  // Venta de mostrador: productos sueltos, sin lavado ni secado. Se cobra al
  // momento y la nota nace finalizada (mig. 112).
  { v: 'PRODUCTOS',    label: 'Productos'    },
];
const TIPO_LABEL = Object.fromEntries(TIPOS_SERVICIO.map(t => [t.v, t.label]));

// Cliente de mostrador: el que deja ropa Por Encargo de paso y no se registra
// (2026-09-29). Ocupa el mismo hueco que el id de un cliente —así el paso 1
// sigue midiendo "ya hay a nombre de quién" con un solo dato— y al armar la
// nota se traduce a cliente_id: null, que es como el backend guarda una nota
// sin cliente. No es un id posible: los ids son números.
const CLIENTE_MOSTRADOR = 'MOSTRADOR';

const TIPOS_PRENDA = [
  { v: 'ROPA',    label: 'Ropa'    },
  { v: 'EDREDON', label: 'Edredón' },
];
const PRENDA_LABEL = Object.fromEntries(TIPOS_PRENDA.map(t => [t.v, t.label]));

// Los tipos de tela y tamaños de edredón son catálogos editables por el admin
// (Ajustes → Etiquetas de encargo). Se cargan desde el API; la nota guarda el
// nombre de la etiqueta elegida como texto.

const FORM_INIT = {
  tipo_tela:      '',
  tamano_edredon: '',
  ajuste:         '0',
  instrucciones:  '',
  forma_pago:     '',
};

// Autoservicio elige LA MÁQUINA, no su tipo (2026-09-29): el mostrador la
// escoge de la lista de máquinas libres, igual que en Salidas, y con la máquina
// ya se sabe su tarifa —así el alta vuelve a enseñar el total de la nota—.
// Cada renglón es una máquina; las notas viejas pueden traer lavadora y
// secadora en el mismo renglón, y por eso caben las dos.
const MAX_CARGAS  = 20;

const TAMANOS = [
  { v: 'chico',   label: 'Chico'   },
  { v: 'mediano', label: 'Mediano' },
  { v: 'grande',  label: 'Grande'  },
  { v: 'jumbo',  label: 'Jumbo'  },
];
const TAMANO_LABEL = Object.fromEntries(TAMANOS.map(t => [t.v, t.label]));

// Los servicios que vende Por Encargo. El servicio es la unidad que se cobra:
// su precio sale de Ajustes y ya lleva dentro el lavado, el secado, el jabón y
// la bolsa. Cada servicio se guarda como una carga.
//
// Los de ropa son fijos (Chico, Mediano, Grande). El Edredón se vende uno por
// tamaño (Individual, Matrimonial…, mig. 130): esos salen del catálogo de
// tamaños de edredón con su precio, y se arman en la pantalla (serviciosDe).
// Viajan como prenda EDREDON en tamaño jumbo, que es lo que los ata a la
// lavadora jumbo cuando se les asigna máquina en Salidas.
const SERVICIOS_ROPA = [
  { v: 'chico',   label: 'Chico',   tamano: 'chico',   tipo_prenda: 'ROPA' },
  { v: 'mediano', label: 'Mediano', tamano: 'mediano', tipo_prenda: 'ROPA' },
  { v: 'grande',  label: 'Grande',  tamano: 'grande',  tipo_prenda: 'ROPA' },
];
// Ya no se venden. No tienen contador: solo aparecen al editar una nota que los
// eligió cuando existían, para no cambiarle el servicio —ni el precio— a
// espaldas de nadie. El Edredón sin tamaño es el de antes de la mig. 130.
const SERVICIOS_LEGADO = [
  { v: 'edredon', label: 'Edredón', tamano: 'jumbo', tipo_prenda: 'EDREDON', legado: true },
  { v: 'jumbo',   label: 'Jumbo',   tamano: 'jumbo', tipo_prenda: 'ROPA',    legado: true },
];
const servicioEdredon = (nombre) => `edredon:${nombre}`;
// La lista completa, en el orden en que se leen en la pantalla y en el ticket.
// Un tamaño de edredón inactivo cuenta como legado: deja de ofrecerse, pero la
// nota que ya lo trae lo conserva.
const serviciosDe = (tamanosEdredon) => [
  ...SERVICIOS_ROPA,
  ...tamanosEdredon.map(e => ({
    v:              servicioEdredon(e.nombre),
    label:          `Edredón ${e.nombre}`,
    tamano:         'jumbo',
    tipo_prenda:    'EDREDON',
    tamano_edredon: e.nombre,
    precio:         e.precio != null ? Number(e.precio) : null,
    legado:         !e.activo,
  })),
  ...SERVICIOS_LEGADO,
];
// Qué servicio se vendió en una carga, leído de lo que quedó guardado. Las
// claves de ropa son las mismas que las de los topes de Ajustes, así que el
// precio del servicio se busca con este valor directamente.
const servicioDeCarga = (c) => {
  if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') {
    return c?.tamano_edredon ? servicioEdredon(c.tamano_edredon) : 'edredon';
  }
  if (c?.tamano === 'chico')   return 'chico';
  if (c?.tamano === 'mediano') return 'mediano';
  if (c?.tamano === 'grande')  return 'grande';
  if (c?.tamano === 'jumbo')  return 'jumbo';
  return '';
};
// Cuántos servicios del mismo tipo caben en una nota.
const MAX_SERVICIOS = 20;

// El detalle por servicio —tipo de tela y tamaño del edredón— está ESCONDIDO a
// petición del negocio (2026-09-28): los dos son opcionales y el mostrador no
// los captura, así que el paso se lee más corto sin ellos. Se enseña otra vez
// poniendo esto en true; el bloque sigue ahí, entero.
const MOSTRAR_DETALLE_SERVICIO = false;

// Datos a nivel nota. La prenda, el tamaño y los productos incluidos viven en
// cada carga (encargoCargas); el ajuste y los productos que el cliente compra
// aparte son de la nota, una sola vez.
const ENCARGO_INIT = {
  cliente_id:      '',
  pago_anticipado: '',
  forma_pago:      '',
  fecha_entrega:   '',
  tiempo_entrega:  '',
  instrucciones:   '',
  ajuste:          '0',
};

// Un servicio de Por Encargo, que se guarda como una carga: qué servicio es
// (de ahí salen su prenda y su tamaño), su tela o tamaño de edredón y el
// material que lleva incluido.
// Ya NO elige tipo de máquina: el servicio se cobra a su precio y la máquina
// —la que esté libre— se le asigna en Salidas sin mover nada del cobro.
// `ajuste` sobrevive en $0 para no borrar el de las notas que se hicieron
// cuando el ajuste era por carga; el de hoy es el de la nota.
const CARGA_ENCARGO_INIT = {
  servicio:               '',
  tipo_prenda:            '',
  tipo_tela:              '',
  tamano_edredon:         '',
  tamano:                 '',
  ajuste:                 '0',
  productos:              [],
};

// Cuándo estará lista la ropa. Es el DÍA que se le promete al cliente, no una
// hora del día (2026-09-25), y es opcional.
const TIEMPOS_ENTREGA = [
  { v: 'MANANA',   label: 'Mañana'    },
  { v: 'DOS_DIAS', label: 'En 2 días' },
  // "Otra" abre el calendario: la fecha se guarda en fecha_entrega.
  { v: 'OTRA',     label: 'Otra'      },
];
const TIEMPO_ENTREGA_LABEL = Object.fromEntries(TIEMPOS_ENTREGA.map(t => [t.v, t.label]));

// Fecha local en formato YYYY-MM-DD, tantos días después de hoy. Sin argumento
// es hoy, que es la entrega por defecto cuando no se promete ningún día.
const fechaISOEnDias = (dias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fechaHoyISO = () => fechaISOEnDias(0);
// Qué fecha se guarda según el día prometido: mañana es hoy + 1, "en 2 días" es
// hoy + 2 y "Otra" es la que se eligió en el calendario (2026-09-25). Así la
// fecha de entrega de la nota dice lo mismo que se le prometió al cliente.
const fechaSegunDiaPrometido = (tiempo, fechaElegida) => {
  if (tiempo === 'MANANA')   return fechaISOEnDias(1);
  if (tiempo === 'DOS_DIAS') return fechaISOEnDias(2);
  return fechaElegida || fechaHoyISO();
};

// Pasos del wizard: Cliente, Servicios (cantidades, ajuste y productos),
// Entrega y Resumen (que incluye el pago). Son cuatro y siempre los mismos: la
// pantalla por carga desapareció al vender por cantidad de servicios, y con
// ella el paso que preguntaba cuántas cargas eran.
const ENCARGO_STEPS = 4;
const PASO_SERVICIOS = 2;
const PASO_ENTREGA   = 3;
const PASO_RESUMEN   = 4;

export default function NuevaNota() {
  const navigate = useNavigate();
  const { id } = useParams();
  const esEdicion = Boolean(id);
  // Nota que ya está cobrada y se está EDITANDO: el cobro no se deshace desde
  // aquí. Ese camino vive en "Revertir pago" del detalle, que pide motivo y
  // solo funciona con la caja de ese cobro abierta; tenerlo en dos sitios
  // obligaba a escribir la misma regla dos veces (2026-09-22).
  const [cobroBloqueado, setCobroBloqueado] = useState(false);
  // Máquinas LIBRES que ofrece el modal de elegir máquina. Se piden al abrirlo.
  const [maquinasLibres,    setMaquinasLibres]    = useState([]);
  const [productosCatalogo, setProductosCatalogo] = useState([]);
  const [telas,             setTelas]             = useState([]);
  const [tamanosEdredon,    setTamanosEdredon]    = useState([]);
  const [precios,           setPrecios]           = useState({ mediana: 70, jumbo: 70, secadora: 45, secadoraJumbo: 45 });
  // Tope de precio por carga (Ajustes); null = sin tope. `edredon` es un tope
  // por prenda que manda sobre el del tamaño para las cargas de edredón.
  const [topes,             setTopes]             = useState({ chico: null, mediano: null, grande: null, jumbo: null, edredon: null });
  // Lo que trae puesto cada servicio de ropa (mig. 132): medidas de cada granel
  // ligado y bolsas. Los de edredón lo traen en su catálogo de tamaños.
  const [precargas,         setPrecargas]         = useState({});
  const [loadingData,       setLoadingData]       = useState(true);
  // Caja del día: si nadie la abrió, los cobros de esta nota no entran en
  // ningún corte (van con caja_id nulo, mig. 101). Se avisa, no se bloquea.
  const [cajaAbierta, setCajaAbierta] = useState(null);
  const [modalCajaOpen, setModalCajaOpen] = useState(false);
  const [form,              setForm]              = useState(FORM_INIT);
  const [productosLista,    setProductosLista]    = useState([]);
  const [error,             setError]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [tipoServicio,      setTipoServicio]      = useState('');
  // Venta de mostrador (mig. 112): sin cargas ni máquinas, se cobra al momento.
  const esVenta = tipoServicio === 'PRODUCTOS';
  const [tipoOpen,          setTipoOpen]          = useState(false);
  // Máquinas de la nota de Autoservicio. Cada renglón es una máquina elegida
  // de la lista de libres: { id?, lavadora, secadora }, con `id` solo en las
  // cargas de una nota que se está editando. Arranca vacío: el contador de
  // "Cantidad de máquinas" se fue con el selector de tipo (2026-09-29), porque
  // el número sale de lo que se elige en el modal.
  const [cargasAuto,        setCargasAuto]        = useState([]);
  // Modal de elegir máquinas (el mismo gesto que "Asignar máquina" de Salidas).
  const [maqModalOpen,      setMaqModalOpen]      = useState(false);
  const [maqModalSel,       setMaqModalSel]       = useState([]);
  const [maqModalError,     setMaqModalError]     = useState('');
  const [loadingMaquinas,   setLoadingMaquinas]   = useState(false);
  const [encargoStep,       setEncargoStep]       = useState(1);
  const [encargoForm,       setEncargoForm]       = useState(ENCARGO_INIT);
  // Arranca SIN servicios: el mostrador dice cuántos son de cada tamaño en el
  // paso 2, y cada uno nace ya con su material incluido.
  const [encargoCargas,     setEncargoCargas]     = useState([]);
  const [encargoLoading,    setEncargoLoading]    = useState(false);
  const [clientes,          setClientes]          = useState([]);
  const [clienteSearch,     setClienteSearch]     = useState('');
  const [nuevoClienteOpen,  setNuevoClienteOpen]  = useState(false);
  // Selector para agregar un producto. `ambito` distingue los productos de la
  // nota (Autoservicio, por botella) de los de una carga (Por Encargo, por
  // medida); `carga` solo aplica al segundo. Un producto puesto no se cambia: se
  // borra y se agrega el correcto.
  const [selectorProducto,  setSelectorProducto]  = useState(null);
  // La venta de mostrador se cobra al momento: "Aceptar" abre este modal, donde
  // se elige la forma de pago y se confirma la creación de la nota. El
  // Autoservicio ya no pasa por aquí (2026-09-23): nace pendiente.
  const [cobroOpen,         setCobroOpen]         = useState(false);
  const [nuevoCliente,      setNuevoCliente]      = useState({ nombre: '', apellido: '', telefono: '' });
  const [creandoCliente,    setCreandoCliente]    = useState(false);
  const [folio,             setFolio]             = useState('');
  const [notaCreada,        setNotaCreada]        = useState(null);
  const tipoRef           = useRef(null);

  // El aviso de nota creada no pide confirmación: corre su animación y abre
  // solo el detalle de la nota que se acaba de crear. Ya no había nada que
  // decidir ahí —el botón Aceptar solo cerraba— y en el mostrador era un
  // toque de más entre una nota y la siguiente. Va al detalle y no a la
  // lista porque es donde siguen las acciones de esa nota (cobrar, salidas,
  // ticket): buscarla otra vez en la lista era el paso que sobraba. Sin id
  // —que no debería pasar, la API devuelve la nota completa— cae a la lista.
  // El plazo cubre la animación completa (el círculo tarda 0.4s y la palomita
  // 0.4s más con 0.2s de retraso, o sea 0.6s) y deja un momento para leer el
  // folio.
  useEffect(() => {
    if (!notaCreada) return;
    // El Autoservicio va directo a SALIDAS (2026-09-29): el cliente está
    // enfrente con su ropa y lo siguiente es encender su máquina, no mirar la
    // nota. Los demás servicios sí van al detalle: ahí es donde siguen sus
    // acciones (cobrar, ticket, avisar que está listo).
    const destino = !notaCreada.id
      ? '/notas'
      : notaCreada.tipo_servicio === 'AUTOSERVICIO'
        ? `/notas/${notaCreada.id}/salidas`
        : `/notas/${notaCreada.id}`;
    const t = setTimeout(() => {
      setNotaCreada(null);
      // replace: la pantalla de destino SUSTITUYE en el historial al
      // formulario que acaba de enviarse, para que el gesto de atrás no
      // devuelva a una nueva nota ya mandada —desde donde se podía crear la
      // misma nota dos veces— sino a la pantalla anterior a empezarla.
      navigate(destino, { replace: true });
    }, 1600);
    return () => clearTimeout(t);
  }, [notaCreada, navigate]);

  useEffect(() => {
    if (!tipoOpen) return;
    const onMouseDown = (e) => {
      if (tipoRef.current && !tipoRef.current.contains(e.target)) {
        setTipoOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [tipoOpen]);

  const precioPorTipo = (tipoMaquina) => {
    if (tipoMaquina === 'secadora') return precios.secadora;
    if (tipoMaquina === 'lavadora_jumbo') return precios.jumbo;
    return precios.mediana;
  };
  // La secadora es de un solo tamaño: precio único (ignora tamaño y prenda).
  const precioSecado = () => precios.secadora;
  // Precio por TIPO de máquina en Por Encargo (mediana/jumbo), independiente de
  // qué máquina física se asigne luego.
  const precioLavadoTipo = (tipo, prenda) =>
    tipo === 'jumbo'   ? precioPorTipo('lavadora_jumbo', prenda)
    : tipo === 'mediana' ? precioPorTipo('lavadora_mediana', prenda)
    : 0;
  const precioSecadoTipo = (tipo, prenda) => (tipo ? precioSecado(tipo, prenda) : 0);
  // Lo que cobra una MÁQUINA en Autoservicio. Es la misma tarifa que aplica el
  // servidor al crear la nota (`tarifaLavadora`/`tarifaSecadora`): la lavadora
  // según su tipo —Mediana o Jumbo— y la secadora a precio único. Saberla aquí
  // es lo que permite enseñar el total en el alta.
  const precioDeMaquina = (m) => {
    if (!m) return 0;
    if (m.tipo === 'secadora') return precioSecado();
    return precioPorTipo(m.tipo === 'lavadora_jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana', 'ROPA');
  };
  // Un renglón es una máquina; las notas viejas pueden traer las dos.
  const subtotalDeCarga = (c) =>
    precioDeMaquina(c.lavadora) + precioDeMaquina(c.secadora)
    // Nota vieja cuya carga se quedó en TIPO sin máquina: se cobra por su tipo,
    // como se cobraba entonces, para no cambiarle el total al editarla.
    + (c.lavadora ? 0 : precioLavadoTipo(c.lavadora_tipo, 'ROPA'))
    + (c.secadora ? 0 : precioSecadoTipo(c.secadora_tipo, 'ROPA'));
  // Ids de las máquinas que la nota ya tiene: no se vuelven a ofrecer.
  const maquinasElegidas = cargasAuto.flatMap(c =>
    [c.lavadora?.id, c.secadora?.id].filter(Boolean).map(String));
  // Qué ES la máquina del renglón, sin nombrarla: "Lavadora Mediana".
  // El resumen habla de lo que se cobra —una lavadora mediana cuesta lo que
  // cuesta, se llame L1 o L8—, así que ahí no pinta el nombre de la máquina ni
  // el número de renglón: es ruido entre el concepto y su importe.
  const tipoDeRenglon = (c) => {
    const partes = [];
    if (c.lavadora) partes.push(`Lavadora ${c.lavadora.tipo === 'lavadora_jumbo' ? 'Jumbo' : 'Mediana'}`);
    if (c.secadora) partes.push('Secadora');
    if (partes.length === 0 && c.lavadora_tipo) partes.push('Lavadora (sin asignar)');
    if (partes.length === 0 && c.secadora_tipo) partes.push('Secadora (sin asignar)');
    return partes.join(' + ');
  };
  // Nombre corto de lo que lleva un renglón: "L3 · Lavadora Mediana". En la
  // lista de arriba SÍ se nombra la máquina: es la que hay que ir a cargar.
  const etiquetaRenglon = (c) => {
    const partes = [];
    if (c.lavadora) partes.push(`${c.lavadora.nombre} · Lavadora${c.lavadora.tipo === 'lavadora_jumbo' ? ' Jumbo' : ' Mediana'}`);
    if (c.secadora) partes.push(`${c.secadora.nombre} · Secadora`);
    if (partes.length === 0 && c.lavadora_tipo) partes.push('Lavadora (sin asignar)');
    if (partes.length === 0 && c.secadora_tipo) partes.push('Secadora (sin asignar)');
    return partes.join(' + ');
  };
  // Ajuste a nivel nota: ya no se captura en ningún lado (la venta de Productos
  // perdió el campo el 2026-10-02). Solo se conserva el de una venta vieja que
  // se reabra; fuera de la venta no suma nada aunque el form arrastre un valor.
  const ajusteNum      = esVenta ? (Number(form.ajuste) || 0) : 0;
  // Precio efectivo de un producto según la unidad de venta: en Autoservicio se
  // vende por BOTELLA (precio_botella); en Por Encargo por MEDIDA (precio_unitario).
  const precioProducto = (prod, unidad = 'medida') => {
    if (!prod) return 0;
    if (prod.clase === 'bolsa') return Number(prod.precio_unitario) || 0; // por pieza
    return unidad === 'botella'
      ? (Number(prod.precio_botella) || 0)
      : (Number(prod.precio_unitario) || 0);
  };
  // Botellas disponibles de un producto (el stock viene en medidas).
  const botellasDisponibles = (prod) => {
    if (!prod) return 0;
    const tpb = Number(prod.medidas_por_botella) || 0;
    const disp = Number(prod.stock_disponible ?? prod.stock_actual) || 0;
    return tpb > 0 ? Math.floor(disp / tpb) : disp;
  };
  // Palabra de la unidad vendida en Autoservicio: botella (granel líquido),
  // unidad (marca y polvo) o bolsa (bolsa, por pieza).
  const unidadVentaNota = (prod, n = 2) => {
    if (prod?.clase === 'bolsa') return n === 1 ? 'bolsa' : 'bolsas';
    if (seVendePorUnidad(prod)) return n === 1 ? 'unidad' : 'unidades';
    return n === 1 ? 'botella' : 'botellas';
  };
  // Granel que trae puesto un servicio Por Encargo. Cada granel dice en
  // Inventario a qué servicios va ligado y cuántas medidas lleva (mig. 131);
  // `servicio` es la clave de ese ligue ('chico'… 'edredon').
  const medidasDisponibles = (p) => Number(p.stock_disponible ?? p.stock_actual) || 0;
  // Solo el granel LÍQUIDO se precarga: es el que se sirve por medidas dentro
  // del servicio. El polvo se vende por unidad, así que se agrega a mano.
  const granelServido = (p) => p.tipo_liquido === 'granel' && !esPolvo(p);
  // `medidas` las dice el servicio (mig. 132), las mismas para cada granel.
  const granelDeServicio = (servicio, medidas) => {
    if (!servicio || !(medidas > 0)) return [];
    return productosCatalogo
      .filter(p => granelServido(p) && (p.servicios_precarga ?? []).includes(servicio))
      // Si quedan menos medidas que las precargadas se pone lo que haya: dejar
      // las de siempre sin existencias haría fallar el guardado por un valor
      // que nadie eligió. Sin existencias, no se pone.
      .map(p => ({
        producto_id: String(p.id),
        cantidad: String(Math.min(medidas, medidasDisponibles(p))),
      }))
      .filter(x => Number(x.cantidad) > 0);
  };
  const subtotalCargas = cargasAuto.reduce((s, c) => s + subtotalDeCarga(c), 0);
  // Ámbito de los productos a nivel nota: en Autoservicio y en la venta de
  // mostrador se vende la pieza completa (botella, unidad o bolsa); en Por
  // Encargo, el granel por medida.
  const ambitoProductosNota = tipoServicio === 'POR_ENCARGO' ? 'encargo' : 'nota';
  // La unidad se resuelve aquí, y no con precioEnAmbito, porque esta suma se
  // calcula más arriba de donde vive ese ayudante.
  const precioProductoNota = (prod) => precioProducto(
    prod,
    ambitoProductosNota === 'encargo' && prod?.tipo_liquido === 'granel'
      && prod?.clase !== 'bolsa' && !esPolvo(prod)
      ? 'medida' : 'botella'
  );
  // En POR ENCARGO lo que el mostrador agrega se parte por cómo se vende: el
  // granel líquido va por MEDIDA y las bolsas por pieza —es lo que se sirve dentro
  // del servicio, así que su precio ya lo paga y gasta de su tope— y lo que se
  // vende por UNIDAD (marca y polvo) se cobra encima: el cliente se lleva el
  // envase entero. En los demás servicios todo producto es una venta.
  const esMaterialDeNota = (prod) =>
    tipoServicio === 'POR_ENCARGO' && !seVendePorUnidad(prod);
  const sumaProductosNota = (cuenta) => productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    if (!prod || !cuenta(prod)) return sum;
    return sum + precioProductoNota(prod) * (Number(p.cantidad) || 0);
  }, 0);
  // Lo que se COBRA de los productos de la nota.
  const subtotalProductos = sumaProductosNota(prod => !esMaterialDeNota(prod));
  // Lo que GASTA del presupuesto de los servicios.
  const materialProductosNota = sumaProductosNota(esMaterialDeNota);
  const precioTotal = subtotalCargas + ajusteNum + subtotalProductos;
  // La venta de Productos no tiene cargas: su total son los productos y el ajuste.
  const totalVenta  = subtotalProductos + ajusteNum;

  useEffect(() => {
    api.get('/caja/actual')
      .then(r => setCajaAbierta(Boolean(r?.abierta)))
      .catch(() => setCajaAbierta(null)); // si falla la consulta, no se avisa nada
  }, []);

  useEffect(() => {
    const promesas = [
      api.get('/productos'),
      api.get('/ajustes'),
      api.get('/clientes'),
      api.get('/etiquetas/tipos-tela'),
      api.get('/etiquetas/tamanos-edredon'),
    ];
    promesas.push(esEdicion ? api.get(`/notas/${id}`) : api.get('/notas/next-folio'));

    Promise.all(promesas)
      .then((resultados) => {
        const [prod, cfg, cli, telasCat, tamanosCat, extra] = resultados;
        setTelas(telasCat || []);
        setTamanosEdredon(tamanosCat || []);
        const nota = esEdicion ? extra : null;
        setFolio(esEdicion ? (nota?.folio ?? '') : (extra?.folio ?? ''));
        // La lista de máquinas la pide el modal al abrirse, no esta carga: lo
        // que importa es lo que está libre en el momento de elegir.
        setProductosCatalogo(prod);
        if (cfg) {
          setPrecios({
            mediana:         cfg.precio_carga_mediana    != null ? Number(cfg.precio_carga_mediana)    : 70,
            jumbo:           cfg.precio_carga_jumbo      != null ? Number(cfg.precio_carga_jumbo)      : 70,
            // Secado por categoría; el precio plano (precio_carga_secadora) es Mediana.
            secadora:        cfg.precio_carga_secadora   != null ? Number(cfg.precio_carga_secadora)   : 45,
            secadoraJumbo:   cfg.precio_secadora_jumbo   != null ? Number(cfg.precio_secadora_jumbo)   : 45,
          });
          setTopes({
            chico:   cfg.tope_carga_chico   != null ? Number(cfg.tope_carga_chico)   : null,
            mediano: cfg.tope_carga_mediano != null ? Number(cfg.tope_carga_mediano) : null,
            grande:  cfg.tope_carga_grande  != null ? Number(cfg.tope_carga_grande)  : null,
            jumbo:   cfg.tope_carga_jumbo   != null ? Number(cfg.tope_carga_jumbo)   : null,
            edredon: cfg.tope_carga_edredon != null ? Number(cfg.tope_carga_edredon) : null,
          });
          setPrecargas(Object.fromEntries(['chico', 'mediano', 'grande'].map(sv => [sv, {
            medidas: Number(cfg[`precarga_medidas_${sv}`] ?? 0),
            bolsas:  Number(cfg[`precarga_bolsas_${sv}`] ?? 0),
          }])));
        }
        setClientes(cli);

        if (esEdicion && nota) {
          // Compat con notas viejas: tipo_servicio=EDREDON significa autoservicio+edredón
          // si no tiene cliente_id, o por_encargo+edredón si lo tiene.
          const esEncargoLegacy = nota.tipo_servicio === 'EDREDON' && nota.cliente_id;
          const esEncargo  = nota.tipo_servicio === 'POR_ENCARGO' || esEncargoLegacy;
          const prendaNota = nota.tipo_prenda
            ?? (nota.tipo_servicio === 'EDREDON' ? 'EDREDON' : 'ROPA');

          if (esEncargo) {
            setTipoServicio('POR_ENCARGO');
          } else {
            setTipoServicio('AUTOSERVICIO');
          }
          const prods = (nota.productos || []).map(p => ({
            producto_id: String(p.producto_id),
            cantidad:    String(p.cantidad),
          }));

          if (esEncargo) {
            // Ya cobrada: el toggle se enseña con lo que hay, pero no se cambia.
            setCobroBloqueado(nota.estado_pago === 'PAGADO');
            setEncargoForm({
              // Sin cliente es de mostrador, no un hueco por llenar: si se
              // dejara vacío, editar la nota no dejaría pasar del paso 1.
              cliente_id:      nota.cliente_id ? String(nota.cliente_id) : CLIENTE_MOSTRADOR,
              pago_anticipado: nota.estado_pago === 'PAGADO' ? 'SI' : 'NO',
              forma_pago:      nota.forma_pago ?? '',
              fecha_entrega:   nota.fecha_entrega  ? String(nota.fecha_entrega).slice(0, 10) : '',
              // Una nota vieja con fecha pero sin día elegido se lee como "Otra".
              tiempo_entrega:  nota.tiempo_entrega ?? (nota.fecha_entrega ? 'OTRA' : ''),
              instrucciones:   nota.instrucciones  ?? '',
              ajuste:          nota.ajuste != null ? String(nota.ajuste) : '0',
            });
            // Los productos de la nota, en UNA sola lista. Una nota hecha
            // cuando el material vivía dentro de cada carga trae ahí su jabón y
            // su bolsa: se suben aquí para que se vean y se puedan editar donde
            // están todos los demás. Al guardar quedan a nivel nota, que para
            // el cobro y para el tope es lo mismo.
            const materialDeCargas = [];
            for (const c of nota.cargas ?? []) {
              for (const pr of c.productos ?? []) {
                const fila = materialDeCargas.find(x => String(x.producto_id) === String(pr.producto_id));
                if (fila) fila.cantidad = String((Number(fila.cantidad) || 0) + Number(pr.cantidad));
                else materialDeCargas.push({ producto_id: String(pr.producto_id), cantidad: String(pr.cantidad) });
              }
            }
            for (const m of materialDeCargas) {
              const fila = prods.find(x => String(x.producto_id) === String(m.producto_id));
              if (fila) fila.cantidad = String((Number(fila.cantidad) || 0) + Number(m.cantidad));
              else prods.push(m);
            }
            setProductosLista(prods);
            // Cargas de la nota; si es una nota vieja sin cargas, se arma una
            // carga a partir de los campos legados a nivel nota.
            const cargasNota = (nota.cargas ?? []).map(c => {
              const prenda = c.tipo_prenda ?? prendaNota;
              return {
                // El id viaja de vuelta al guardar: es lo que permite al servidor
                // reconocer las cargas que ya se lavaron y no rehacerlas.
                id:                     c.id,
                // Qué servicio se vendió, leído del tamaño y la prenda. Una nota
                // vieja con carga Jumbo de ropa conserva su servicio: aparece con
                // su contador, marcado como que ya no se vende.
                servicio:               servicioDeCarga({ tipo_prenda: prenda, tamano: c.tamano, tamano_edredon: c.tamano_edredon }),
                tipo_prenda:            prenda,
                tipo_tela:              c.tipo_tela      ?? '',
                tamano_edredon:         c.tamano_edredon ?? '',
                tamano:                 c.tamano         ?? '',
                // El ajuste por carga ya no se captura, pero el de una nota hecha
                // cuando existía se conserva para no cambiarle el precio al
                // guardarla.
                ajuste:                 c.ajuste != null ? String(c.ajuste) : '0',
                // Sin productos: los que traía se subieron a la lista de la
                // nota, que es donde se administran todos desde que son una
                // sola lista.
                productos:              [],
              };
            });
            setEncargoCargas(cargasNota.length > 0 ? cargasNota : [{
              ...CARGA_ENCARGO_INIT,
              servicio:       servicioDeCarga({ tipo_prenda: prendaNota, tamano: nota.tamano, tamano_edredon: nota.tamano_edredon }),
              tipo_prenda:    prendaNota,
              tipo_tela:      nota.tipo_tela      ?? '',
              tamano_edredon: nota.tamano_edredon ?? '',
              tamano:         nota.tamano         ?? '',
            }]);
          } else {
            // AUTOSERVICIO o EDREDON usan el mismo formulario
            setForm({
              tipo_tela:       nota.tipo_tela      ?? '',
              tamano_edredon:  nota.tamano_edredon ?? '',
              ajuste:          nota.ajuste         != null ? String(nota.ajuste) : '0',
              instrucciones:   nota.instrucciones  ?? '',
              forma_pago:      nota.forma_pago     ?? '',
            });
            // Cada renglón es una máquina de la nota. Se lee la que tiene
            // puesta (o la que ya usó, si se liberó); una nota vieja que se
            // quedó en TIPO sin máquina conserva su tipo, para que al guardarla
            // no cambie de precio ni pierda lo que pidió.
            const maqDe = (id, nombre, tipo) =>
              (id && nombre ? { id, nombre, tipo } : null);
            const cargasNota = (nota.cargas ?? []).map(c => ({
              // Igual que en Por Encargo: el id identifica las cargas que ya
              // se lavaron para que el servidor no las rehaga.
              id:             c.id,
              lavadora:       maqDe(c.lavadora_id ?? c.lavadora_usada_id,
                                    c.lavadora_nombre ?? c.lavadora_usada_nombre,
                                    c.lavadora_tipo ?? c.lavadora_usada_tipo ?? 'lavadora_mediana'),
              secadora:       maqDe(c.secadora_id ?? c.secadora_usada_id,
                                    c.secadora_nombre ?? c.secadora_usada_nombre,
                                    'secadora'),
              lavadora_tipo:  c.lavadora_tipo_previsto ?? '',
              secadora_tipo:  c.secadora_tipo_previsto ?? '',
            }));
            setCargasAuto(cargasNota);
            setProductosLista(prods);
          }
        }
      })
      .finally(() => setLoadingData(false));
  }, [id, esEdicion]);

  const agregarProducto = (productoId = '') =>
    setProductosLista(prev => [...prev, { producto_id: String(productoId), cantidad: '1' }]);

  const actualizarProducto = (i, field, value) =>
    setProductosLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarProducto = (i) =>
    setProductosLista(prev => prev.filter((_, idx) => idx !== i));

  // Quita una máquina de la nota. La numeración sale del índice, así que las
  // siguientes se recorren solas.
  const eliminarCargaAuto = (i) =>
    setCargasAuto(prev => prev.filter((_, idx) => idx !== i));

  // ── Elegir máquinas (modal) ─────────────────────────────
  // Las máquinas de la nota se escogen de la lista de LIBRES, igual que en
  // Salidas. Se piden al abrir el modal y no al cargar la pantalla: entre que
  // se abre el formulario y se elige la máquina, otro compañero pudo haberla
  // ocupado, y lo que importa es lo que está libre AHORA.
  const abrirSelectorMaquinas = async () => {
    setMaqModalSel([]);
    setMaqModalError('');
    setMaqModalOpen(true);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      // Solo las que están LIBRES DE VERDAD: ni en uso, ni en mantenimiento, ni
      // apuntadas ya en otra nota abierta (`reservada`). En Salidas esas sí se
      // ofrecen —ahí el empleado tiene la ropa delante y decide si se arriesga
      // a que el otro inicie primero—, pero al dar de alta la nota no: se
      // estaría vendiendo una máquina que otro cliente puede arrancar antes, y
      // aquí ya se cobra por ella. Tampoco las que esta misma nota ya tiene.
      setMaquinasLibres((data ?? []).filter(m =>
        m.estado === 'disponible'
        && !m.reservada
        && !maquinasElegidas.includes(String(m.id))));
    } catch (err) {
      setMaqModalError(err.message);
    } finally {
      setLoadingMaquinas(false);
    }
  };

  const toggleMaquinaSel = (maquinaId) =>
    setMaqModalSel(prev => (prev.some(x => String(x) === String(maquinaId))
      ? prev.filter(x => String(x) !== String(maquinaId))
      : [...prev, String(maquinaId)]));

  // Cada máquina marcada entra como un renglón propio de la nota, con su
  // tarifa. Igual que en Salidas: una máquina de más es una máquina más, no un
  // añadido a la de al lado.
  const confirmarMaquinas = () => {
    const elegidas = maqModalSel
      .map(id => maquinasLibres.find(m => String(m.id) === String(id)))
      .filter(Boolean)
      .map(m => (m.tipo === 'secadora'
        ? { lavadora: null, secadora: m }
        : { lavadora: m, secadora: null }));
    setCargasAuto(prev => [...prev, ...elegidas].slice(0, MAX_CARGAS));
    setMaqModalOpen(false);
    setMaqModalSel([]);
    setError('');
  };

  const handleEncargoChange = (e) => {
    const { name, value } = e.target;
    setEncargoForm(f => ({ ...f, [name]: value }));
  };

  // ── Servicios de Por Encargo ────────────────────────────
  const SERVICIOS = serviciosDe(tamanosEdredon);
  const SERVICIO_POR_V = Object.fromEntries(SERVICIOS.map(s => [s.v, s]));
  // Cuántos servicios de un tipo lleva la nota. La cuenta sale de las cargas:
  // no hay un contador aparte que pueda acabar diciendo otra cosa.
  const cuentaServicio = (serv) => encargoCargas.filter(c => c.servicio === serv).length;
  // Los que se enseñan con contador: los que se venden, más los de legado solo
  // si la nota que se está editando los trae.
  const serviciosVisibles = SERVICIOS.filter(s => !s.legado || cuentaServicio(s.v) > 0);
  // Lo que se cobra por un servicio, de Ajustes. null = sin precio configurado:
  // entonces no se puede vender y la pantalla lo dice.
  const precioServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    if (s && 'precio' in s) return s.precio;  // tamaño de edredón: su catálogo
    return topes[serv] ?? null;
  };

  // Un servicio nuevo nace vacío: su material —jabón, suavizante y la bolsa que
  // le toca— va a la LISTA DE PRODUCTOS de la nota, junto con lo que el cliente
  // compre. Es una sola lista (2026-09-28): tener el material en un bloque y los
  // productos en otro obligaba a mirar dos sitios para saber qué lleva la nota,
  // y el de arriba contaba "por servicio" mientras el de abajo contaba piezas.
  const nuevoServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    return {
      ...CARGA_ENCARGO_INIT, servicio: serv, tamano: s.tamano, tipo_prenda: s.tipo_prenda,
      tamano_edredon: s.tamano_edredon ?? '',
    };
  };

  // Lo que un servicio trae puesto: el granel ligado a él y la bolsa que le
  // toca, en las cantidades que dice el servicio en Ajustes, si hay existencia.
  const materialDeServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    const { medidas, bolsas } = precargaDeServicio(s);
    const bolsa = bolsaDeCargaConStock({ tamano: s.tamano, tipo_prenda: s.tipo_prenda });
    // Como el granel: si quedan menos bolsas de las que lleva, van las que haya.
    const nBolsas = bolsa ? Math.min(bolsas, Number(bolsa.stock_disponible ?? bolsa.stock_actual) || 0) : 0;
    return [
      ...granelDeServicio(servicioBolsa({ tamano: s.tamano, tipo_prenda: s.tipo_prenda }), medidas),
      ...(nBolsas > 0 ? [{ producto_id: String(bolsa.id), cantidad: String(nBolsas) }] : []),
    ];
  };
  // Cuántas medidas de granel y cuántas bolsas trae puestas un servicio, según
  // Ajustes (mig. 132). Sin configurar, nada.
  function precargaDeServicio(s) {
    if (s.tamano_edredon) {
      const e = tamanosEdredon.find(x => x.nombre === s.tamano_edredon);
      return { medidas: Number(e?.precarga_medidas ?? 0), bolsas: Number(e?.precarga_bolsas ?? 0) };
    }
    return precargas[s.v] ?? { medidas: 0, bolsas: 0 };
  }

  // Suma (o resta, con `veces` negativo) el material de un servicio a la lista
  // de productos de la nota. Al quitar un servicio se va lo que trajo; si el
  // renglón se queda en cero, desaparece.
  const ajustarMaterial = (serv, veces) => {
    if (veces === 0) return;
    const material = materialDeServicio(serv);
    if (material.length === 0) return;
    setProductosLista(prev => {
      const lista = prev.map(p => ({ ...p }));
      for (const m of material) {
        const delta = (Number(m.cantidad) || 0) * veces;
        const fila = lista.find(p => String(p.producto_id) === String(m.producto_id));
        if (fila) fila.cantidad = String(Math.max(0, (Number(fila.cantidad) || 0) + delta));
        else if (delta > 0) lista.push({ producto_id: String(m.producto_id), cantidad: String(delta) });
      }
      return lista.filter(p => (Number(p.cantidad) || 0) > 0);
    });
  };

  // Pone la nota en N servicios de un tipo, conservando los que ya estaban y
  // dejándolos siempre en el orden de SERVICIOS, que es el que se lee en la
  // pantalla y en el ticket. El material de los que entran (o salen) se suma o
  // se resta de la lista de productos.
  const setCantidadServicio = (serv, n) => {
    const objetivo = Math.max(0, Math.min(MAX_SERVICIOS, n));
    const actuales = cuentaServicio(serv);
    if (objetivo === actuales) return;
    setEncargoCargas(prev => {
      const mios = prev.filter(c => c.servicio === serv);
      const nuevos = objetivo < mios.length
        ? mios.slice(0, objetivo)
        : [...mios, ...Array.from({ length: objetivo - mios.length }, () => nuevoServicio(serv))];
      const juntos = [...prev.filter(c => c.servicio !== serv), ...nuevos];
      // Una carga sin servicio reconocible (nota muy vieja, sin tamaño) se
      // queda al final en vez de desaparecer del formulario.
      return [
        ...SERVICIOS.flatMap(s => juntos.filter(c => c.servicio === s.v)),
        ...juntos.filter(c => !SERVICIO_POR_V[c.servicio]),
      ];
    });
    ajustarMaterial(serv, objetivo - actuales);
  };

  const actualizarCargaEncargo = (i, cambios) =>
    setEncargoCargas(prev => prev.map((c, idx) => (idx === i ? { ...c, ...cambios } : c)));

  // Diferencias entre los dos ámbitos, en un solo lugar: Por Encargo cobra por
  // medida y solo admite granel; Autoservicio cobra por botella (o pieza) y admite
  // todo el catálogo.
  const esCarga        = (ambito) => ambito === 'carga';
  // Los productos que el cliente compra en una nota Por Encargo van a la nota
  // (no a un servicio), pero se sirven como dentro de un servicio: el granel
  // por medida y los de marca por unidad. El servidor los cobra con esa misma
  // regla, así que la pantalla tiene que usarla o el total no cuadraría.
  const porMedidaEnAmbito = (ambito) => ambito === 'carga' || ambito === 'encargo';
  // La marca y el polvo se venden por unidad (el envase completo) en todas
  // partes: no se sirven por medidas como el granel líquido (2026-09-25). Así que
  // dentro de una carga de Por Encargo el granel líquido va por medida y lo demás
  // por unidad.
  const porMedida = (prod, ambito) =>
    porMedidaEnAmbito(ambito) && prod?.tipo_liquido === 'granel'
    && prod?.clase !== 'bolsa' && !esPolvo(prod);
  const precioEnAmbito = (prod, ambito) => precioProducto(prod, porMedida(prod, ambito) ? 'medida' : 'botella');
  const unidadEnAmbito = (prod, ambito, n = 2) => (porMedida(prod, ambito)
    ? (n === 1 ? 'medida' : 'medidas')
    : unidadVentaNota(prod, n));
  // Cuántas piezas se pueden vender: medidas si se sirve por medida, y envases
  // completos (botellas o unidades) si se vende por unidad.
  const disponiblesDe  = (prod, ambito) => {
    if (!prod) return 0;
    return porMedida(prod, ambito)
      ? Number(prod.stock_disponible ?? prod.stock_actual) || 0
      : botellasDisponibles(prod);
  };
  // Precio con su unidad: "$5.00/medida".
  const precioProductoTexto = (prod, ambito) =>
    `$${precioEnAmbito(prod, ambito).toFixed(2)}/${unidadEnAmbito(prod, ambito, 1)}`;
  // Lo anterior más las existencias: "$5.00/medida · 140 medidas". Solo en el
  // selector, que es donde sirven para decidir.
  const detalleProducto = (prod, ambito) => {
    const disp = disponiblesDe(prod, ambito);
    return `${precioProductoTexto(prod, ambito)} · ${disp} ${unidadEnAmbito(prod, ambito, disp)}`;
  };

  // Agrega a la nota el producto elegido en el modal. Los productos siempre van
  // a la nota: en Por Encargo el material que va DENTRO del servicio no se elige
  // aquí —lo pone el servicio— y lo que se elige es lo que el cliente compra.
  const elegirProducto = (productoId) => {
    if (!selectorProducto) return;
    agregarProducto(productoId);
    setSelectorProducto(null);
  };

  const crearCliente = async () => {
    const nombre = capitalizarNombre(nuevoCliente.nombre);
    if (!nombre) return;
    setCreandoCliente(true);
    setError('');
    try {
      const c = await api.post('/clientes', {
        nombre,
        apellido: capitalizarNombre(nuevoCliente.apellido) || undefined,
        telefono: nuevoCliente.telefono.trim() || undefined,
      });
      setClientes(prev => [...prev, c].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setEncargoForm(f => ({ ...f, cliente_id: String(c.id) }));
      setNuevoCliente({ nombre: '', apellido: '', telefono: '' });
      setNuevoClienteOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreandoCliente(false);
    }
  };

  // Cliente → Servicios → Entrega → Resumen (con el pago debajo). El orden es el
  // del mostrador (2026-09-25): se acuerda la entrega, se revisa lo que va a
  // cobrarse y el pago se deja al final, que es cuando se cobra de verdad —y
  // ahí mismo se crea la nota.
  // Los servicios (cuántos de cada tamaño), el ajuste y los productos caben en
  // una sola pantalla: antes eran el paso de "cuántas cargas" más una pantalla
  // por cada una, y con tres cargas el mostrador pasaba por cinco.
  const nCargas     = encargoCargas.length;
  const pasoEntrega = PASO_ENTREGA;
  const pasoResumen = PASO_RESUMEN;

  // Precio de un producto DENTRO de una carga: el granel se sirve por medida y los
  // de marca por unidad, el envase completo (2026-09-25).
  // Se cobra aparte, encima del tope: marca y polvo (se venden por unidad).
  const esProductoMarca = (prod) => seVendePorUnidad(prod);
  const precioProductoCarga = (prod) =>
    precioProducto(prod, esProductoMarca(prod) ? 'botella' : 'medida');
  const sumaProductosCarga = (lista, cuenta = () => true) => (lista ?? []).reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    if (!prod || !cuenta(prod)) return sum;
    return sum + precioProductoCarga(prod) * (Number(p.cantidad) || 0);
  }, 0);
  // Contra el tope cuenta lo que se SIRVE dentro del servicio (granel y bolsa);
  // los de MARCA se venden por unidad y van encima.
  const subtotalAbsorbidoLista = (lista) => sumaProductosCarga(lista, p => !esProductoMarca(p));
  const subtotalMarcaLista     = (lista) => sumaProductosCarga(lista, esProductoMarca);

  // ── Bolsas (Por Encargo): la ligada al servicio, tantas como diga Ajustes ──
  const bolsasCatalogo = productosCatalogo.filter(p => p.clase === 'bolsa');
  // Qué servicio es la carga. Cada bolsa dice a cuáles va ligada (mig. 125), así
  // que el nombre de la bolsa ya no importa: manda lo que se eligió al darla de
  // alta. El jumbo de ropa ya no se vende y no tiene bolsa propia.
  // Clave con que la bolsa y el granel se ligan a un servicio. Distinta de
  // servicioDeCarga: al ligue le da igual el tamaño del edredón, todos van al
  // mismo servicio 'edredon'.
  const servicioBolsa = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') return 'edredon';
    if (c?.tamano === 'chico')   return 'chico';
    if (c?.tamano === 'mediano') return 'mediano';
    if (c?.tamano === 'grande')  return 'grande';
    return null;
  };
  const bolsaDeCarga = (c) => {
    const servicio = servicioBolsa(c);
    if (!servicio) return null;
    return bolsasCatalogo.find(b => (b.servicios_bolsa ?? []).includes(servicio)) ?? null;
  };
  // Existencia disponible de una bolsa (piezas). Sin existencia no se incluye
  // (para no bloquear la nota) y se avisa en la carga.
  const bolsaTieneStock = (b) => b && Number(b.stock_disponible ?? b.stock_actual) > 0;
  // La bolsa que le toca a la carga por su tamaño, si queda existencia.
  const bolsaDeCargaConStock = (c) => {
    const b = bolsaDeCarga(c);
    return bolsaTieneStock(b) ? b : null;
  };

  // Tope de la carga (Ajustes). Prenda edredón usa su tope dedicado (manda
  // sobre el del tamaño). NULL = sin tope configurado.
  const topeDeCarga  = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') {
      // Por tamaño (mig. 130); el de una carga vieja sin tamaño, el precio único.
      if (!c.tamano_edredon) return topes.edredon ?? null;
      const nombre = String(c.tamano_edredon).trim().toLowerCase();
      const e = tamanosEdredon.find(x => String(x.nombre).trim().toLowerCase() === nombre);
      return e?.precio != null ? Number(e.precio) : null;
    }
    return c?.tamano ? (topes[c.tamano] ?? null) : null;
  };

  // Lo que le cuesta al negocio la MÁQUINA de un servicio. La nota ya no elige
  // tipo de máquina, pero el servicio sí sabe cuál le toca: Chico, Mediano y Grande van
  // en lavadora y secadora medianas, y el Edredón en la lavadora jumbo —secarlo
  // es una decisión aparte, así que no cuenta—. Jumbo de ropa ya no se vende;
  // se conserva para las notas que lo eligieron.
  const costoMaquinasServicio = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') return precios.jumbo;
    if (c?.tamano === 'jumbo')  return precios.jumbo + precios.secadora;
    if (['chico', 'mediano', 'grande'].includes(c?.tamano)) return precios.mediana + precios.secadora;
    return 0;
  };

  // Costo interno de la carga: la máquina que le toca + el material que se sirve
  // dentro (granel y bolsa). Es lo que se compara contra el tope,
  // porque el precio del servicio tiene que cubrir las dos cosas: si la máquina
  // no contara, el tope dejaría servir hasta el último peso como si lavar fuera
  // gratis. Solo el ajuste manual va aparte y no cuenta.
  //
  // Una nota vieja trae su máquina elegida y con precio: ahí manda el suyo.
  const usadoContraTope = (c) => {
    const elegidas = precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda)
      + precioSecadoTipo(c.secadora_tipo, c.tipo_prenda);
    return (elegidas > 0 ? elegidas : costoMaquinasServicio(c))
      + subtotalAbsorbidoLista(c.productos);
  };

  // Precio cobrado por una carga de encargo. Con tope configurado el precio ES
  // el tope (precio fijo del servicio, aunque el material cueste menos); sin
  // tope —notas viejas sin tamaño— es la suma real. En los dos casos se suman
  // encima los productos de MARCA, que se venden por unidad, y el ajuste manual.
  const subtotalCargaEncargo = (c) => {
    const tope = topeDeCarga(c);
    const base = tope != null ? Number(tope) : usadoContraTope(c);
    return base + subtotalMarcaLista(c.productos) + (Number(c.ajuste) || 0);
  };
  // Ajuste de la nota: descuento (negativo) o cargo extra (positivo). Es uno
  // solo para toda la nota desde que los servicios se venden por cantidad. Va
  // antes que las cuentas de abajo porque entra en el presupuesto del tope.
  const ajusteEncargo       = Number(encargoForm.ajuste) || 0;
  // Lo que suman los servicios, sin los productos sueltos ni el ajuste.
  const subtotalServicios   = encargoCargas.reduce((s, c) => s + subtotalCargaEncargo(c), 0);
  // Presupuesto de material de la nota: lo que se cobra por los servicios. Todo
  // el material —el que va dentro de cada servicio y el que se agrega en
  // Productos— sale de aquí, así que sirve para lo mismo que el tope de una
  // carga: que no se regale más jabón del que el precio paga.
  const presupuestoServicios = encargoCargas.reduce((s, c) => {
    const tope = topeDeCarga(c);
    return s + (tope != null ? Number(tope) : 0);
  }, 0);
  const materialUsado = encargoCargas.reduce((s, c) => s + usadoContraTope(c), 0)
    + materialProductosNota;
  // El AJUSTE también entra en la cuenta, porque cambia lo que la nota cobra por
  // esos servicios: un descuento de $20 deja $130 para pagar lo mismo, y un
  // cargo extra da más aire. Se suma al presupuesto (con su signo), no al
  // usado, que es lo que de verdad cuesta el servicio.
  const presupuestoConAjuste = presupuestoServicios + ajusteEncargo;
  // Cuánto se pasa del presupuesto (0 o menos = cabe).
  const excesoDeLaNota = presupuestoServicios > 0 ? materialUsado - presupuestoConAjuste : 0;
  const encargoPrecioTotal  = subtotalServicios + subtotalProductos + ajusteEncargo;

  const excesoDeCarga = (c) => {
    const tope = topeDeCarga(c);
    return tope != null ? usadoContraTope(c) - tope : 0;
  };
  const esClienteMostrador = encargoForm.cliente_id === CLIENTE_MOSTRADOR;
  const clienteSeleccionado = clientes.find(c => String(c.id) === String(encargoForm.cliente_id));
  const sinAcentos = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const clienteSearchQ    = sinAcentos(clienteSearch.trim());
  // Coincide si alguna palabra del nombre/apellido EMPIEZA con la búsqueda (no
  // subcadena: "ana" no debe traer "Pastrana"). El teléfono sí por subcadena.
  const empiezaAlgunaPalabra = (texto) =>
    sinAcentos(texto).split(/\s+/).some(w => w.startsWith(clienteSearchQ));
  const clientesFiltrados = clienteSearchQ
    ? clientes.filter(c =>
        empiezaAlgunaPalabra(`${c.nombre ?? ''} ${c.apellido ?? ''}`) ||
        sinAcentos(c.telefono).includes(clienteSearchQ)
      )
    : clientes;

  // Servicios sin precio configurado en Ajustes: no se pueden vender, porque el
  // precio del servicio ES lo que se cobra (el servidor también los rechaza).
  const serviciosSinPrecio = SERVICIOS.filter(s => cuentaServicio(s.v) > 0 && precioServicio(s.v) == null);

  const encargoPuedeAvanzar = (() => {
    if (encargoStep === 1) return !!encargoForm.cliente_id;
    if (encargoStep === PASO_SERVICIOS) {
      if (nCargas < 1) return false;
      if (serviciosSinPrecio.length > 0) return false;
      // Un servicio cuyo material incluido cuesta más de lo que se cobra por él
      // se vendería en pérdida: se frena aquí, como lo frena el servidor.
      if (encargoCargas.some(c => excesoDeCarga(c) > 0)) return false;
      // Y lo mismo con todo el material junto contra lo que cobran los
      // servicios: los productos que se agregan abajo gastan del mismo bolsillo.
      if (excesoDeLaNota > 0) return false;
      // El ajuste no puede dejar la nota en negativo.
      if (encargoPrecioTotal < 0) return false;
      return true;
    }
    return true;
  })();

  // El pago se captura debajo del resumen, en el último paso: sin él no se crea
  // la nota. Si pagó anticipado, además hay que decir cómo pagó.
  const pagoCapturado = Boolean(encargoForm.pago_anticipado)
    && (encargoForm.pago_anticipado !== 'SI' || Boolean(encargoForm.forma_pago));

  const handleEncargoSubmit = async () => {
    setError('');
    if (!pagoCapturado) {
      setError(encargoForm.pago_anticipado
        ? 'Elige la forma de pago.'
        : 'Indica si hay pago anticipado.');
      return;
    }
    // Servicio sin precio en Ajustes: no se puede vender. El servidor también lo
    // rechaza, pero aquí se dice antes y con el nombre del servicio.
    if (serviciosSinPrecio.length > 0) {
      setError(`Falta el precio de: ${serviciosSinPrecio.map(s => s.label).join(', ')}. `
        + 'Configúralo en Ajustes → Servicios Por Encargo.');
      return;
    }
    // Todo el material contra lo que cobran los servicios. El servidor lo
    // rechaza también; aquí se dice antes y con los números a la vista.
    if (excesoDeLaNota > 0) {
      setError(`El material de la nota suma $${materialUsado.toFixed(2)} y los servicios `
        + `se cobran en $${presupuestoConAjuste.toFixed(2)}`
        + (ajusteEncargo !== 0 ? ' (ya con el ajuste). ' : '. ')
        + `Baja $${excesoDeLaNota.toFixed(2)}: quita productos o sirve menos.`);
      return;
    }
    // Material incluido que cuesta más de lo que se cobra por el servicio: se
    // vendería en pérdida. Igual que arriba, el servidor lo rechaza también.
    const idxExcedida = encargoCargas.findIndex(c => excesoDeCarga(c) > 0);
    if (idxExcedida >= 0) {
      const c = encargoCargas[idxExcedida];
      const exceso = usadoContraTope(c) - Number(topeDeCarga(c));
      const nombre = SERVICIO_POR_V[c.servicio]?.label ?? `Carga ${idxExcedida + 1}`;
      setError(`El servicio ${nombre} se cobra en $${Number(topeDeCarga(c)).toFixed(2)} `
        + `y su material incluido suma $${usadoContraTope(c).toFixed(2)}. `
        + `Baja $${exceso.toFixed(2)}: quita algún producto o la bolsa.`);
      return;
    }
    setEncargoLoading(true);
    try {
      const cargasPayload = encargoCargas.map(c => ({
        id:             c.id ?? null,
        tipo_prenda:    c.tipo_prenda || 'ROPA',
        tipo_tela:      c.tipo_prenda === 'ROPA'    ? (c.tipo_tela || null) : null,
        tamano_edredon: c.tipo_prenda === 'EDREDON' ? (c.tamano_edredon || null) : null,
        tamano:         c.tamano || null,
        // Sin tipo de máquina: el servicio se cobra a su precio y la máquina se
        // le asigna en Salidas, la que esté libre.
        lavadora_tipo:  null,
        secadora_tipo:  null,
        activar:        false,
        // El ajuste de hoy es el de la nota; aquí solo viaja el que traía una
        // nota hecha cuando era por carga, para no borrárselo al editarla.
        ajuste:         Number(c.ajuste) || 0,
        // El material incluido (jabón, suavizante y bolsa) va dentro del
        // servicio: ahí lo absorbe su precio en vez de cobrarse encima.
        productos:      (c.productos ?? [])
          .filter(p => p.producto_id && p.cantidad)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
      }));
      const payload = {
        tipo_servicio:      'POR_ENCARGO',
        // Prenda a nivel nota (para lista/badge): la de la primera carga.
        tipo_prenda:    encargoCargas[0]?.tipo_prenda || 'ROPA',
        // Mostrador va sin cliente: la nota queda a su nombre en pantalla y el
        // teléfono, si hay que mandarle algo, se captura desde el ticket.
        cliente_id:     esClienteMostrador ? null : Number(encargoForm.cliente_id),
        cargas:         cargasPayload,
        ajuste:         ajusteEncargo,
        // Lo que el cliente compra aparte: va a la nota y se cobra ENCIMA del
        // precio de los servicios.
        productos:      productosLista
          .filter(p => p.producto_id && p.cantidad)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
        estado_pago:    encargoForm.pago_anticipado === 'SI' ? 'PAGADO' : 'PENDIENTE',
        // Forma de pago solo si pagó anticipado; si queda a deber, va null.
        forma_pago:     encargoForm.pago_anticipado === 'SI' ? (encargoForm.forma_pago || null) : null,
        // Si no se eligió fecha, la entrega se da por hecho para hoy.
        fecha_entrega:  fechaSegunDiaPrometido(encargoForm.tiempo_entrega, encargoForm.fecha_entrega),
        tiempo_entrega: encargoForm.tiempo_entrega || null,
        instrucciones:  encargoForm.instrucciones  || null,
      };
      if (esEdicion) {
        await api.patch(`/notas/${id}`, payload);
        navigate(`/notas/${id}`);
      } else {
        const creada = await api.post('/notas', payload);
        setNotaCreada(creada);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setEncargoLoading(false);
    }
  };

  // Lo que le falta a la nota para poder guardarse. Devuelve el problema o null
  // si todo está en orden. Lo usan el Autoservicio (que guarda directo) y la
  // venta de Productos (que antes de guardar pasa por el cobro).
  const problemaDeLaNota = () => {
    if (esVenta) {
      return productosLista.some(p => p.producto_id && Number(p.cantidad) > 0)
        ? null
        : 'Agrega al menos un producto: una venta sin productos no es nota.';
    }
    if (cargasAuto.length === 0) {
      return 'Agrega al menos una máquina: es lo que la nota le cobra al cliente.';
    }
    return null;
  };

  // "Aceptar" de la venta de mostrador: valida y abre el cobro. La nota se crea
  // desde el modal, ya con la forma de pago elegida.
  const abrirCobro = () => {
    const problema = problemaDeLaNota();
    setError(problema ?? '');
    if (!problema) setCobroOpen(true);
  };

  // Se llama desde el modal (sin evento) y como submit del formulario.
  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (tipoServicio !== 'AUTOSERVICIO' && !esVenta) return;
    setError('');

    const problema = problemaDeLaNota();
    if (problema) {
      setError(problema);
      setCobroOpen(false);
      return;
    }
    // Solo la venta de mostrador se cobra al momento: ahí sí hace falta la
    // forma de pago. El autoservicio nace pendiente y se liquida en el detalle.
    if (esVenta && !form.forma_pago) {
      setError('Elige la forma de pago.');
      return;
    }

    setLoading(true);

    // La venta de mostrador no lleva cargas, ni máquinas, ni cliente: solo sus
    // productos y el ajuste. Nace pagada y finalizada; el backend descuenta el
    // inventario en el acto.
    const payloadVenta = {
      tipo_servicio:  'PRODUCTOS',
      tipo_prenda:    'ROPA',
      estado_pago:    'PAGADO',
      forma_pago:     form.forma_pago || null,
      ajuste:         ajusteNum,
      productos:      productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

    const payloadAutoservicio = {
      tipo_servicio:       'AUTOSERVICIO',
      // La prenda/tela ahora viven en cada carga; a nivel nota se guarda la de
      // la primera carga solo para la lista/badge.
      tipo_prenda:     cargasAuto[0]?.tipo_prenda || 'ROPA',
      // Autoservicio nace En Espera SIN máquina: se elige el tipo y la máquina
      // física se asigna después en Salidas (igual que Por Encargo).
      estado:          'EN_ESPERA',
      // El autoservicio ya no se cobra al crear la nota (2026-09-23): nace
      // pendiente y se liquida desde el detalle, como Por Encargo. En edición
      // no se manda nada de pago — el cobro tiene su propia puerta y mandar
      // 'PENDIENTE' sobre una nota ya cobrada sería intentar revertirlo.
      ...(esEdicion ? {} : { estado_pago: 'PENDIENTE' }),
      // null (no undefined) para que al editar, limpiar un campo lo borre.
      instrucciones:   form.instrucciones || null,
      tipo_tela:       null,
      tamano_edredon:  null,
      // Cada renglón manda LA MÁQUINA elegida (2026-09-29). El servidor la
      // valida, la deja asignada —sin arrancarla— y la tarifa, que es el precio
      // que este formulario ya enseñó en el resumen. Los `*_tipo` solo viajan
      // en las cargas de una nota vieja que se quedó sin máquina, para no
      // perder lo que pidió ni cambiarle el precio.
      cargas:          cargasAuto.map(c => ({
        id:             c.id ?? null,
        lavadora_id:    c.lavadora?.id ?? null,
        secadora_id:    c.secadora?.id ?? null,
        lavadora_tipo:  c.lavadora ? null : (c.lavadora_tipo || null),
        secadora_tipo:  c.secadora ? null : (c.secadora_tipo || null),
        tipo_prenda:    'ROPA',
      })),
      // Autoservicio ya no tiene Ajuste (2026-09-25).
      ajuste:          0,
      productos:       productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

    const payload = esVenta ? payloadVenta : payloadAutoservicio;

    try {
      if (esEdicion) {
        await api.patch(`/notas/${id}`, payload);
        setCobroOpen(false);
        navigate(`/notas/${id}`);
      } else {
        const creada = await api.post('/notas', payload);
        setCobroOpen(false);
        setNotaCreada(creada);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Buscador de cliente del paso 1 de Por Encargo, el único servicio que lleva
  // cliente: ahí la ropa es de alguien que va a volver por ella. Autoservicio y
  // la venta de Productos son de mostrador, y quedan a nombre de Mostrador.
  const bloqueCliente = () => (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Cliente</h2>
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Buscar por nombre o teléfono..."
          value={clienteSearch}
          onChange={e => setClienteSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
        />
      </div>

      {esClienteMostrador && !clienteSearchQ && (
        <div className="flex items-center justify-between gap-3 bg-light-blue border border-blue-200 rounded-lg px-4 py-3">
          <div>
            <p className="text-xs font-medium text-blue uppercase tracking-wide">Cliente seleccionado</p>
            <p className="font-medium text-gray-900">Mostrador</p>
            <p className="text-sm text-gray-500">Sin cliente registrado</p>
          </div>
          <button
            type="button"
            onClick={() => setEncargoForm(f => ({ ...f, cliente_id: '' }))}
            aria-label="Quitar cliente"
            className="flex-shrink-0 px-3 py-1.5 text-sm text-blue-700 hover:bg-light-blue rounded-md transition-colors"
          >
            Cambiar
          </button>
        </div>
      )}

      {clienteSeleccionado && !clienteSearchQ && (
        <div className="flex items-center justify-between gap-3 bg-light-blue border border-blue-200 rounded-lg px-4 py-3">
          <div>
            <p className="text-xs font-medium text-blue uppercase tracking-wide">Cliente seleccionado</p>
            <p className="font-medium text-gray-900">
              {`${clienteSeleccionado.nombre}${clienteSeleccionado.apellido ? ' ' + clienteSeleccionado.apellido : ''}`}
            </p>
            {clienteSeleccionado.telefono && (
              <p className="text-sm text-gray-500">{clienteSeleccionado.telefono}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEncargoForm(f => ({ ...f, cliente_id: '' }))}
            aria-label="Quitar cliente"
            className="flex-shrink-0 px-3 py-1.5 text-sm text-blue-700 hover:bg-light-blue rounded-md transition-colors"
          >
            Cambiar
          </button>
        </div>
      )}

      {clienteSearchQ && (
        <div className="border border-gray-200 rounded-lg bg-white max-h-72 overflow-y-auto divide-y divide-gray-100">
          {clientesFiltrados.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No se encontraron clientes
            </div>
          ) : (
            clientesFiltrados.map(c => {
              const selected = String(encargoForm.cliente_id) === String(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setEncargoForm(f => ({ ...f, cliente_id: String(c.id) }));
                    setClienteSearch('');
                  }}
                  className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${
                    selected ? 'bg-light-blue' : 'hover:bg-gray-50'
                  }`}
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {`${c.nombre}${c.apellido ? ' ' + c.apellido : ''}`}
                    </p>
                    {c.telefono && (
                      <p className="text-sm text-gray-500">{c.telefono}</p>
                    )}
                  </div>
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selected ? 'border-blue bg-blue' : 'border-gray-300'
                  }`}>
                    {selected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Mostrador va ARRIBA de crear cliente porque es la salida rápida: el
          que deja ropa de paso no se registra, y darlo de alta para nunca
          volver a buscarlo llenaba la libreta de clientes de una sola nota. */}
      <button
        type="button"
        onClick={() => {
          setEncargoForm(f => ({ ...f, cliente_id: CLIENTE_MOSTRADOR }));
          setClienteSearch('');
        }}
        className={`w-full py-3 border-2 border-dashed rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium ${
          esClienteMostrador
            ? 'border-blue bg-light-blue text-blue-700'
            : 'border-gray-300 text-gray-600 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3.75 9.35V21h16.5V9.35M2.6 5.6l1.2-1.2a1.5 1.5 0 011.05-.4h14.3a1.5 1.5 0 011.05.4l1.2 1.2a3 3 0 01-.6 4.7 3 3 0 01-3.75-.6 3 3 0 01-2.25 1 3 3 0 01-2.25-1 3 3 0 01-2.25 1 3 3 0 01-2.25-1 3 3 0 01-3.75.6 3 3 0 01-.6-4.7M8.25 21v-6.75h7.5V21" />
        </svg>
        Mostrador
      </button>

      <button
        type="button"
        onClick={() => setNuevoClienteOpen(true)}
        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Crear nuevo cliente
      </button>
    </div>
  );

  // Lista de productos a nivel nota. La comparten Autoservicio —donde acompañan
  // al lavado—, la venta de Productos, donde son la nota entera, y Por Encargo,
  // donde son lo que el cliente compra aparte del servicio. La unidad la pone el
  // servicio: pieza completa en los dos primeros, granel por medida en Por Encargo.
  const bloqueProductos = () => (
    <div>
      <div className="flex items-baseline gap-2 min-w-0 mb-2">
        <h2 className={LABEL_CLS + ' mb-0'}>Productos</h2>
        {productosLista.length > 0 && (
          <span className="text-xs text-gray-500 truncate">
            {productosLista.length} {productosLista.length === 1 ? 'producto' : 'productos'}
          </span>
        )}
      </div>

      {/* Mismo campo que el de máquinas: se ve y se toca como los demás campos
          del formulario, y lo que abre es el modal para elegir. Agregar vive
          arriba de la lista para que no cambie de sitio conforme crece. */}
      <button
        type="button"
        onClick={() => setSelectorProducto({ ambito: ambitoProductosNota })}
        className="w-full px-4 py-3.5 mb-3 border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between gap-2 hover:border-gray-400 transition-colors"
      >
        <span className="text-gray-400 truncate">
          {productosLista.length === 0 ? 'Elige un producto' : 'Agregar otro producto'}
        </span>
        <svg className="w-5 h-5 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Misma fila compacta que en Por Encargo. La diferencia es la unidad:
          aquí se vende la pieza completa (botella, unidad o bolsa). Sin
          productos no se pinta la caja: el campo de arriba ya dice que no hay
          ninguno y qué hacer, igual que en Máquinas. */}
      {productosLista.length > 0 && (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {productosLista.map((item, i) => {
            const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
            const cant = Number(item.cantidad) || 0;
            const subtotal = precioProductoNota(prod) * cant;
            // En Por Encargo el granel y las bolsas son material del servicio:
            // no se cobran, gastan de su presupuesto. Se dice en el renglón
            // para que nadie piense que ese importe se le está cobrando.
            const esMaterial = esMaterialDeNota(prod);
            return (
              <div key={i} className={`flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                {/* Solo texto: el producto no se cambia, se borra el renglón y se
                    agrega el correcto. */}
                <div className="flex-1 min-w-[10rem]">
                  <p className={`text-sm font-semibold ${prod ? 'text-gray-900' : 'text-gray-400'}`}>
                    {prod ? etiquetaProducto(prod) : 'Producto no disponible'}
                  </p>
                  <p className="text-xs text-gray-500 tabular-nums">
                    {prod ? precioProductoTexto(prod, ambitoProductosNota) : '—'}
                    {prod && esMaterial && (
                      <span className="ml-1.5 not-italic text-gray-400">· va dentro del servicio</span>
                    )}
                  </p>
                </div>

                {/* Cantidad, importe y borrar viajan juntos: si no caben
                    junto al nombre, bajan al siguiente renglón. */}
                <div className="flex flex-1 items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => actualizarProducto(i, 'cantidad', String(Math.max(1, cant - 1)))}
                      disabled={cant <= 1}
                      aria-label="Disminuir cantidad"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-gray-900 tabular-nums">{cant}</span>
                    <button
                      type="button"
                      onClick={() => actualizarProducto(i, 'cantidad', String(cant + 1))}
                      aria-label="Aumentar cantidad"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 transition-colors"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`w-16 text-right text-base font-bold tabular-nums ${
                      esMaterial ? 'text-gray-400' : 'text-blue-700'
                    }`}>
                      ${subtotal.toFixed(2)}
                    </span>

                    <button
                      type="button"
                      onClick={() => eliminarProducto(i)}
                      aria-label="Eliminar producto"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
        })}

        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 space-y-1.5">
          {/* En Por Encargo puede no cobrarse nada —si todo lo agregado se
              sirve dentro del servicio—, y un "Se cobra aparte $0.00" solo
              hace dudar de si falta cobrar algo. Lo que gasta del tope se ve
              en el renglón de abajo. */}
          {(tipoServicio !== 'POR_ENCARGO' || subtotalProductos > 0) && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {tipoServicio === 'POR_ENCARGO' ? 'Se cobra aparte' : 'Total productos'}
              </span>
              <span className="text-base font-bold text-dark-blue tabular-nums">
                ${subtotalProductos.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
      </div>
    );
  }

  return (
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">
            {esEdicion ? 'Editar Nota' : 'Nueva Nota'}
          </h1>
          <p className="text-sm text-gray-500">
            {esEdicion ? 'Modifica los datos y guarda' : 'Crea una nueva nota'}
          </p>
        </div>
      </div>

      {/* Recordatorio de abrir caja: sin sesión abierta, lo que se cobre hoy
          no queda en ningún corte. Solo al crear (al editar ya no aplica). */}
      {!esEdicion && cajaAbierta === false && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">La caja del día no está abierta</p>
          <p className="mt-0.5 text-sm text-amber-800">
            Puedes hacer la nota, pero lo que cobres no va a aparecer en el corte de hoy.
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
        onAbierta={() => { setModalCajaOpen(false); setCajaAbierta(true); }} // el aviso desaparece
      />

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ── # Nota ──────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2"># Nota</label>
          <input
            type="text" disabled readOnly value={folio}
            placeholder="—"
            className={INPUT_DISABLED_CLS}
          />
        </div>

        {/* ── Tipo de Servicio ────────────────────────────── */}
        <div ref={tipoRef} className="relative">
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Tipo de Servicio
          </label>
          <button
            type="button"
            onClick={() => setTipoOpen(o => !o)}
            className={`w-full px-4 py-3.5 border rounded-lg bg-white text-left flex items-center justify-between transition-colors ${
              tipoOpen
                ? 'border-blue-500 ring-1 ring-blue-500'
                : tipoServicio
                  ? 'border-green-600'
                  : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <span className={tipoServicio ? 'text-gray-900' : 'text-gray-400'}>
              {tipoServicio ? TIPO_LABEL[tipoServicio] : 'Seleccionar'}
            </span>
            {tipoServicio && !tipoOpen ? (
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className={`w-5 h-5 text-gray-500 transition-transform ${tipoOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {tipoOpen && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
              {TIPOS_SERVICIO.map(opt => {
                const selected = tipoServicio === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => { setTipoServicio(opt.v); setTipoOpen(false); }}
                    className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 border-b last:border-0 border-gray-100"
                  >
                    <span className="text-base text-gray-900">{opt.label}</span>
                    <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selected ? 'border-blue bg-blue' : 'border-gray-300'
                    }`}>
                      {selected && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {tipoServicio === 'POR_ENCARGO' && (
          <div className="space-y-6">
            {/* Indicador de paso */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Paso {encargoStep} de {ENCARGO_STEPS}
              </p>
              <div className="flex gap-1">
                {Array.from({ length: ENCARGO_STEPS }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-6 rounded-full ${
                      i + 1 <= encargoStep ? 'bg-blue' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Paso 1 — Cliente */}
            {encargoStep === 1 && bloqueCliente()}

            {/* Paso 2 — Servicios: cuántos de cada uno, su detalle, lo que
                llevan incluido, el ajuste de la nota y los productos que el
                cliente compra aparte. Antes esto eran dos pasos (cuántas
                cargas y luego una pantalla por carga). */}
            {encargoStep === PASO_SERVICIOS && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      Cantidad de servicios <span className="text-red-500">*</span>
                    </h2>
                    <p className="text-xs text-gray-400 mt-1">
                      Cada servicio ya incluye lavado, secado, jabón y bolsa.
                    </p>
                  </div>

                  {/* Un renglón por servicio: su precio a la izquierda y el
                      contador a la derecha, para leer de un tirón qué se vende
                      y cuánto lleva la nota. */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    {serviciosVisibles.map((s, i) => {
                      const cant   = cuentaServicio(s.v);
                      const precio = precioServicio(s.v);
                      return (
                        <div
                          key={s.v}
                          className={`flex items-center gap-3 px-4 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                        >
                          {/* El importe del renglón va pegado al precio, no en
                              una tercera columna: en el teléfono esa columna se
                              caía sola al siguiente renglón. */}
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-gray-900 truncate">
                              {s.label}
                              {s.legado && (
                                <span className="ml-2 text-xs font-normal text-gray-400">ya no se vende</span>
                              )}
                            </p>
                            <p className={`text-xs tabular-nums ${precio == null ? 'text-red-600' : 'text-gray-500'}`}>
                              {precio == null ? 'Sin precio configurado' : `$${precio.toFixed(2)} c/u`}
                              {precio != null && cant > 0 && (
                                <span className="ml-1.5 font-bold text-blue-700">· ${(precio * cant).toFixed(2)}</span>
                              )}
                            </p>
                          </div>

                          <div className="flex flex-shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCantidadServicio(s.v, cant - 1)}
                              disabled={cant <= 0}
                              aria-label={`Quitar un servicio ${s.label}`}
                              className="w-12 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              −
                            </button>
                            <span className="w-10 text-center text-lg font-bold text-gray-900 tabular-nums">{cant}</span>
                            <button
                              type="button"
                              onClick={() => setCantidadServicio(s.v, cant + 1)}
                              disabled={cant >= MAX_SERVICIOS || precio == null}
                              aria-label={`Agregar un servicio ${s.label}`}
                              className="w-12 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {nCargas > 0 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {nCargas} {nCargas === 1 ? 'servicio' : 'servicios'}
                        </span>
                        <span className="text-base font-bold text-dark-blue tabular-nums">
                          ${subtotalServicios.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {nCargas === 0 && (
                    <p className="text-sm text-gray-500">
                      Agrega al menos un servicio para continuar.
                    </p>
                  )}
                  {serviciosSinPrecio.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <p className="text-sm font-semibold text-red-700">
                        Falta el precio de: {serviciosSinPrecio.map(s => s.label).join(', ')}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Se configura en Ajustes → Servicios Por Encargo.
                      </p>
                    </div>
                  )}
                </div>

                {/* Ajuste de la nota */}
                <Separador />
                <div>
                  <label className={LABEL_CLS}>Ajuste ($)</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                      <input
                        type="number" name="ajuste" step="any"
                        value={encargoForm.ajuste} onChange={handleEncargoChange}
                        placeholder="Ej. -10 para descuento, 20 para cargo extra"
                        className={`${INPUT_CLS} pl-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setEncargoForm(f => ({ ...f, ajuste: String((Number(f.ajuste) || 0) - 10) }))}
                      aria-label="Disminuir ajuste"
                      className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => setEncargoForm(f => ({ ...f, ajuste: String((Number(f.ajuste) || 0) + 10) }))}
                      aria-label="Aumentar ajuste"
                      className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">Descuento (negativo) o cargo extra (positivo)</p>
                </div>

                {/* Escondido por ahora, a petición del negocio: la tela y el
                    tamaño del edredón son opcionales y el mostrador no los está
                    capturando. Se vuelve a enseñar poniendo la bandera en true;
                    lo que hay debajo se conserva tal cual para eso. */}
                {MOSTRAR_DETALLE_SERVICIO && (<>
                {/* Detalle de cada servicio: la tela de la ropa y el tamaño del
                    edredón, los dos opcionales. Es un renglón por servicio, no
                    una pantalla: con tres servicios son tres renglones. */}
                {nCargas > 0 && (
                  <>
                    <Separador />
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Detalle de cada servicio <span className="font-normal text-gray-400">(opcional)</span>
                      </h3>
                      <div className="space-y-3">
                        {encargoCargas.map((c, idx) => {
                          const nombre = SERVICIO_POR_V[c.servicio]?.label ?? 'Servicio';
                          // Cuántos van de este servicio para numerarlo: "Chico 1",
                          // "Chico 2". Con uno solo no se numera.
                          const mismos = encargoCargas.filter(x => x.servicio === c.servicio);
                          const num    = mismos.indexOf(c) + 1;
                          const etiqueta = mismos.length > 1 ? `${nombre} ${num}` : nombre;
                          return (
                            <div key={idx} className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 space-y-2.5">
                              <p className="text-sm font-semibold text-gray-900">{etiqueta}</p>
                              {/* El tamaño del edredón ya es su servicio
                                  (mig. 130): no se elige aparte. */}
                              {c.tipo_prenda === 'EDREDON' ? null : (
                                <select
                                  value={c.tipo_tela}
                                  onChange={e => actualizarCargaEncargo(idx, { tipo_tela: e.target.value })}
                                  className={`${INPUT_CLS} bg-white`}
                                >
                                  <option value="">Tipo de tela sin asignar</option>
                                  {telas.filter(t => t.activo || t.nombre === c.tipo_tela).map(t => (
                                    <option key={t.id} value={t.nombre}>{t.nombre}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                </>)}

                {/* Productos: UNA sola lista con lo que lleva la nota, el
                    material que traen puestos los servicios incluido. Cada
                    renglón dice si va dentro del servicio (granel y bolsas, que
                    gastan de su precio) o si se cobra aparte (los de marca). */}
                <Separador />
                {bloqueProductos()}

                {/* Un servicio cuyo material cuesta más de lo que se cobra se
                    vendería en pérdida: aquí se ve de cuál se trata. */}
                {encargoCargas.map((c, idx) => {
                  const exceso = excesoDeCarga(c);
                  if (!(exceso > 0)) return null;
                  const nombre = SERVICIO_POR_V[c.servicio]?.label ?? `Carga ${idx + 1}`;
                  return (
                    <div key={idx} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <p className="text-sm font-semibold text-red-700">
                        El servicio {nombre} se cobra en ${Number(topeDeCarga(c)).toFixed(2)} y su material suma ${usadoContraTope(c).toFixed(2)}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Baja ${exceso.toFixed(2)}: sirve menos, quita la bolsa o sube el precio del servicio en Ajustes.
                      </p>
                    </div>
                  );
                })}

                {/* El tope, siempre a la vista: cuánto se cobra, cuánto lleva
                    gastado el material y cuánto queda. Es lo que deja servir
                    con cabeza en vez de descubrir al final que no cabía. */}
                {presupuestoServicios > 0 && (
                  excesoDeLaNota > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <p className="text-sm font-semibold text-red-700">
                        El material suma ${materialUsado.toFixed(2)} y el tope
                        {ajusteEncargo !== 0 ? ', ya con el ajuste,' : ''} es ${presupuestoConAjuste.toFixed(2)}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Baja ${excesoDeLaNota.toFixed(2)}: quita productos, sirve menos
                        {ajusteEncargo < 0 ? ', baja el descuento' : ''} o sube el precio de los servicios en Ajustes.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 text-right tabular-nums">
                      {nCargas === 1 ? 'Tope del servicio' : 'Tope de los servicios'}: ${presupuestoServicios.toFixed(2)}
                      {' · '}usado ${materialUsado.toFixed(2)}
                      {/* El ajuste se nombra aparte cuando lo hay: cambia lo que
                          queda, y verlo restado sin decir de dónde sale hacía
                          dudar de la cuenta. */}
                      {ajusteEncargo !== 0 && (
                        <>{' · '}ajuste {ajusteEncargo < 0 ? '−' : '+'}${Math.abs(ajusteEncargo).toFixed(2)}</>
                      )}
                      {' · '}disponible ${(presupuestoConAjuste - materialUsado).toFixed(2)}
                    </p>
                  )
                )}

                <div className="flex items-baseline justify-between border-t border-gray-200 pt-4">
                  <span className="text-sm font-medium text-gray-700">Total de la nota</span>
                  <span className="text-2xl font-bold text-blue-700 tabular-nums">${encargoPrecioTotal.toFixed(2)}</span>
                </div>
                {encargoPrecioTotal < 0 && (
                  <p className="text-sm text-red-600">
                    El total no puede quedar en negativo: revisa el ajuste.
                  </p>
                )}
              </div>
            )}

            {/* Entrega: fecha + tiempo + instrucciones */}
            {encargoStep === pasoEntrega && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-900">Entrega</h2>
                <div>
                  <label className={LABEL_CLS}>
                    Día que estará lista <span className="text-gray-400 font-normal">(opcional)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {TIEMPOS_ENTREGA.map(t => {
                      const selected = encargoForm.tiempo_entrega === t.v;
                      return (
                        <button
                          key={t.v}
                          type="button"
                          // Al salir de "Otra" se limpia la fecha: quedaría una
                          // fecha suelta contradiciendo lo que dice el botón.
                          onClick={() => setEncargoForm(f => {
                            const v = f.tiempo_entrega === t.v ? '' : t.v;
                            return { ...f, tiempo_entrega: v, ...(v === 'OTRA' ? {} : { fecha_entrega: '' }) };
                          })}
                          className={`py-4 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                            selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* El calendario solo aparece con "Otra": mañana y en 2 días se
                    explican solos (2026-09-25). */}
                {encargoForm.tiempo_entrega === 'OTRA' && (
                  <div>
                    <label className={LABEL_CLS}>Fecha de entrega</label>
                    <div className="relative">
                      <input
                        type="date" name="fecha_entrega"
                        value={encargoForm.fecha_entrega} onChange={handleEncargoChange}
                        // Con appearance-none se oculta el ícono del calendario; al
                        // hacer click se abre el selector nativo (showPicker) para que
                        // se pueda elegir la fecha tocando cualquier parte del campo.
                        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* no soportado */ } }}
                        className={`${INPUT_CLS} min-w-0 block bg-white h-[54px] cursor-pointer ${
                          encargoForm.fecha_entrega ? '' : 'text-transparent'
                        }`}
                      />
                      {!encargoForm.fecha_entrega && (
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base">
                          Seleccionar fecha
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <label className={LABEL_CLS}>Instrucciones</label>
                  <textarea
                    name="instrucciones" rows={5}
                    value={encargoForm.instrucciones} onChange={handleEncargoChange}
                    placeholder="Instrucciones especiales..."
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
              </div>
            )}

            {/* Resumen */}
            {encargoStep === pasoResumen && (
              <div className="bg-light-blue border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-medium text-blue uppercase tracking-wide mb-2">Resumen</p>
                <div className="space-y-1 mb-3 text-sm text-blue-700">
                  <div className="flex justify-between">
                    <span>Cliente</span>
                    <span className="font-medium">
                      {clienteSeleccionado
                        ? `${clienteSeleccionado.nombre}${clienteSeleccionado.apellido ? ' ' + clienteSeleccionado.apellido : ''}`
                        : esClienteMostrador ? 'Mostrador' : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pago Anticipado</span>
                    <span className="font-medium">
                      {encargoForm.pago_anticipado === 'SI' ? 'Sí' : encargoForm.pago_anticipado === 'NO' ? 'No' : '—'}
                    </span>
                  </div>
                  {encargoForm.pago_anticipado === 'SI' && encargoForm.forma_pago && (
                    <div className="flex justify-between">
                      <span>Forma de pago</span>
                      <span className="font-medium">
                        {encargoForm.forma_pago === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                      </span>
                    </div>
                  )}
                  {encargoForm.tiempo_entrega && (
                    <div className="flex justify-between">
                      <span>Lista</span>
                      <span className="font-medium">
                        {encargoForm.tiempo_entrega === 'OTRA'
                          ? (encargoForm.fecha_entrega || 'Otra fecha')
                          : TIEMPO_ENTREGA_LABEL[encargoForm.tiempo_entrega]}
                      </span>
                    </div>
                  )}
                </div>
                {/* Un renglón por servicio con su precio, y debajo lo que va
                    encima de ellos: los productos que el cliente compra y el
                    ajuste. El material incluido no se lista aquí —ya está
                    pagado en el precio del servicio— y se revisa en el paso 2. */}
                <div className="space-y-2 mb-2 text-sm text-blue border-t border-blue-200 pt-4">
                  {encargoCargas.map((c, i) => {
                    const nombre = SERVICIO_POR_V[c.servicio]?.label ?? 'Servicio';
                    // El tamaño del edredón ya va en el nombre del servicio.
                    const detalle = c.tipo_tela || '';
                    const ajusteCarga = Number(c.ajuste) || 0;
                    return (
                      <div key={i} className="flex justify-between gap-2">
                        <span>
                          Servicio {nombre}
                          {detalle ? <span className="text-blue-700/70"> · {detalle}</span> : null}
                          {ajusteCarga !== 0 && (
                            <span className="text-blue-700/70">
                              {' '}({ajusteCarga < 0 ? '−' : '+'}${Math.abs(ajusteCarga).toFixed(2)} de ajuste)
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums">${subtotalCargaEncargo(c).toFixed(2)}</span>
                      </div>
                    );
                  })}

                  {productosLista.some(p => {
                    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
                    return prod && Number(p.cantidad) > 0 && !esMaterialDeNota(prod);
                  }) && (
                    <div className="pt-2 mt-1 border-t border-blue-200/60 space-y-2">
                      {productosLista.map((p, j) => {
                        const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
                        const cant = Number(p.cantidad) || 0;
                        // El material no se cobra: va dentro del precio del
                        // servicio, así que no es un renglón del resumen.
                        if (!prod || cant <= 0 || esMaterialDeNota(prod)) return null;
                        return (
                          <div key={j} className="flex justify-between gap-2">
                            <span>
                              {etiquetaProducto(prod)} × {cant} {unidadEnAmbito(prod, ambitoProductosNota, cant)}
                            </span>
                            <span className="tabular-nums">${(precioProductoNota(prod) * cant).toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {ajusteEncargo !== 0 && (
                    <div className="flex justify-between gap-2 pt-2 mt-1 border-t border-blue-200/60">
                      <span>Ajuste de la nota</span>
                      <span className="tabular-nums">
                        {ajusteEncargo < 0 ? '−' : '+'}${Math.abs(ajusteEncargo).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-baseline justify-between border-t border-blue-200 pt-4">
                  <span className="text-sm font-medium text-blue">Total de la nota</span>
                  <span className="text-3xl font-bold text-blue-700">${encargoPrecioTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Pago anticipado: va debajo del resumen, en el mismo paso, para
                cobrar viendo lo que se cobra (2026-09-25). */}
            {encargoStep === pasoResumen && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Pago Anticipado</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[{ v: 'SI', label: 'Sí' }, { v: 'NO', label: 'No' }].map(opt => {
                    const selected = encargoForm.pago_anticipado === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        disabled={cobroBloqueado}
                        onClick={() => setEncargoForm(f => ({ ...f, pago_anticipado: opt.v, forma_pago: opt.v === 'SI' ? f.forma_pago : '' }))}
                        className={`py-8 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                          selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                        } ${cobroBloqueado ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* La nota ya se cobró: deshacerlo es una decisión de dinero y
                    vive en su propia puerta, con motivo y con la regla de la
                    caja. Se deja ver que está pagada, pero no se cambia desde
                    aquí (2026-09-22). */}
                {cobroBloqueado && (
                  <p className="text-sm text-gray-500">
                    Esta nota ya está cobrada, así que el cobro no se toca desde aquí: para
                    deshacerlo usa <span className="font-medium text-gray-700">Revertir pago</span> y
                    para corregir cómo se pagó,{' '}
                    <span className="font-medium text-gray-700">Corregir forma de pago</span>, los dos
                    en el detalle de la nota.
                  </p>
                )}

                {/* Forma de pago: solo si pagó anticipado (si queda a deber, aún
                    no hay pago). */}
                {encargoForm.pago_anticipado === 'SI' && (
                  <div className="space-y-3 pt-2">
                    <h2 className="text-base font-semibold text-gray-900">Forma de pago</h2>
                    <div className="grid grid-cols-3 gap-3">
                      {FORMAS_PAGO.map(opt => {
                        const selected = encargoForm.forma_pago === opt.v;
                        return (
                          <button
                            key={opt.v}
                            type="button"
                            // En una nota ya cobrada el servidor ignora lo que
                            // se mande aquí (conserva la forma con la que se
                            // cobró): corregirla tiene su propio botón en el
                            // detalle, con la regla de la caja.
                            disabled={cobroBloqueado}
                            onClick={() => setEncargoForm(f => ({ ...f, forma_pago: opt.v }))}
                            className={`py-6 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                              selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                            } ${cobroBloqueado ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            {/* Navegación del wizard */}
            <div className="flex gap-3 pb-4">
              <button
                type="button"
                onClick={() => {
                  if (encargoStep > 1) setEncargoStep(s => s - 1);
                  else navigate(-1);
                }}
                disabled={encargoLoading}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                {encargoStep === 1 ? 'Cancelar' : 'Atrás'}
              </button>
              {encargoStep < ENCARGO_STEPS ? (
                <button
                  type="button"
                  onClick={() => setEncargoStep(s => s + 1)}
                  disabled={!encargoPuedeAvanzar}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEncargoSubmit}
                  disabled={encargoLoading || !pagoCapturado}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {encargoLoading
                    ? (esEdicion ? 'Guardando...' : 'Creando...')
                    : (esEdicion ? 'Guardar cambios' : 'Crear nota')}
                </button>
              )}
            </div>
          </div>
        )}

        {tipoServicio === 'AUTOSERVICIO' && (
        <div className="space-y-8">
        {/* 32 px entre todas las secciones, de la captura al cobro: el mismo
            aire que el paso de carga de Por Encargo, ahora que las líneas
            marcan la separación. El contenedor propio evita depender del
            space-y del <form>, que dejaba el resumen más pegado que el resto. */}
        <div className="space-y-8">

          {/* ── Máquinas ─────────────────────────────────────
              La nota se arma eligiendo las máquinas que va a usar el cliente,
              de la lista de libres y en el mismo modal que Salidas (2026-09-29).
              Antes se decía "cuántas" y de qué tipo, y la máquina física se
              elegía después: eran dos capturas para lo mismo, y hasta la segunda
              la nota no valía nada. Ahora cada máquina entra con su tarifa, así
              que el resumen ya puede decir lo que se va a cobrar. */}
          <div>
            <div className="flex items-baseline gap-2 min-w-0 mb-2">
              <h2 className={LABEL_CLS + ' mb-0'}>Máquinas <span className="text-red-500">*</span></h2>
              {cargasAuto.length > 0 && (
                <span className="text-xs text-gray-500 truncate">
                  {cargasAuto.length} {cargasAuto.length === 1 ? 'máquina' : 'máquinas'}
                </span>
              )}
            </div>

            {/* El campo es un SELECTOR, no un botón de "agregar": se ve y se
                toca como los demás campos del formulario —el mismo alto y el
                mismo borde— y lo que despliega es el modal con las máquinas
                libres. Elegir la máquina es capturar un dato de la
                nota, no una acción aparte, y como campo se lee así. */}
            <button
              type="button"
              onClick={abrirSelectorMaquinas}
              disabled={cargasAuto.length >= MAX_CARGAS}
              className={`w-full px-4 py-3.5 mb-3 border rounded-lg bg-white text-left flex items-center justify-between gap-2 transition-colors disabled:opacity-60 ${
                maqModalOpen
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <span className="text-gray-400 truncate">
                {cargasAuto.length === 0 ? 'Elige lavadora o secadora' : 'Agregar otra máquina'}
              </span>
              {/* Un + y no la flecha del desplegable: lo que hay detrás no es
                  una lista que se abre y se cierra en el propio campo, sino un
                  modal donde se marcan varias. En el gris del campo, que es un
                  signo de lo que se puede hacer, no una llamada de atención. */}
              <svg className="w-5 h-5 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Misma fila compacta que los productos: qué es, qué cobra y el
                tache para quitarla. Sin máquinas no se pinta la caja: el campo
                de arriba ya dice que no hay ninguna y qué hacer, y un "No hay
                máquinas en esta nota" debajo de "Elige lavadora o secadora" es
                decir dos veces lo mismo. */}
            {cargasAuto.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {cargasAuto.map((c, i) => (
                  <div key={i} className={`flex items-center gap-x-2 px-3 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">Máquina {i + 1}</p>
                      <p className="text-xs text-gray-500 truncate">{etiquetaRenglon(c) || '—'}</p>
                    </div>
                    <span className="w-16 text-right text-base font-bold text-blue-700 tabular-nums">
                      ${subtotalDeCarga(c).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => eliminarCargaAuto(i)}
                      aria-label={`Quitar máquina ${i + 1}`}
                      className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
              ))}

              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Total máquinas
                </span>
                <span className="text-base font-bold text-dark-blue tabular-nums">
                  ${subtotalCargas.toFixed(2)}
                </span>
              </div>
            </div>
            )}

            {/* Asignar no aparta la máquina: se la queda quien le dé a Iniciar
                primero, y eso pasa en Salidas. Se dice aquí para que nadie
                cuente con una máquina que otro puede arrancar antes. */}
            {cargasAuto.length > 0 && (
              <p className="text-xs text-gray-400 mt-1.5">
                Quedan asignadas; se inician en Salidas.
              </p>
            )}
          </div>

          <Separador />

          {/* ── Productos ────────────────────────────────────── */}

          {bloqueProductos()}
        </div>

        <Separador />

        {/* ── Precio Total ─────────────────────────────────── */}
        {(() => {
          return (
            <div>
            <h2 className={LABEL_CLS}>Resumen</h2>
            <div className="bg-light-blue border border-blue-200 rounded-xl p-4">
              <div className="space-y-2.5 mb-3 text-sm text-blue-700">
                <div className="flex justify-between">
                  <span>Servicio</span>
                  <span className="font-medium">{TIPO_LABEL[tipoServicio]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Máquinas</span>
                  <span className="font-medium">{cargasAuto.length}</span>
                </div>
              </div>

              {/* Cada máquina con lo que cobra (2026-09-29). Los precios
                  volvieron al resumen en cuanto la máquina se elige aquí: ya se
                  sabe cuál es y, con ella, su tarifa. */}
              {cargasAuto.length > 0 && (
                <div className="space-y-1.5 mb-3 last:mb-0 text-sm text-blue border-t border-blue-200 pt-3">
                  {cargasAuto.map((c, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="font-medium truncate">{tipoDeRenglon(c) || '—'}</span>
                      <span className="flex-shrink-0 font-medium tabular-nums">
                        ${subtotalDeCarga(c).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {productosLista.length > 0 && (
                <div className="space-y-2 mb-3 last:mb-0 text-sm text-blue border-t border-blue-200 pt-3">
                  <div className="flex justify-between font-medium">
                    <span>Productos</span>
                    <span>${subtotalProductos.toFixed(2)}</span>
                  </div>
                  <div className="pl-3 mt-1.5 space-y-1.5 text-xs text-blue-700/80">
                    {productosLista
                      .map(item => ({
                        item,
                        prod: productosCatalogo.find(x => String(x.id) === String(item.producto_id)),
                      }))
                      .filter(x => x.prod)
                      .sort((a, b) => ordenProducto(a.prod) - ordenProducto(b.prod))
                      .map(({ item, prod }, i) => {
                      const cant = Number(item.cantidad) || 0;
                      return (
                        <div key={i} className="flex justify-between gap-2">
                          {/* "· Granel" distingue el bidón del producto de marca
                              que se llama igual (Suavizante vs. Ensueño). */}
                          <span>
                            {etiquetaProducto(prod)}{prod.tipo_liquido === 'granel' && !esPolvo(prod) ? ' · Granel' : ''}
                            {' × '}{cant} {unidadVentaNota(prod, cant)}
                          </span>
                          <span className="flex-shrink-0">${(precioProducto(prod, 'botella') * cant).toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* El Total vuelve (2026-09-29): con la máquina elegida aquí, el
                  alta ya sabe lo que cuesta la nota. Lo que NO vuelve es el
                  cobro: la nota nace pendiente y se liquida desde su detalle
                  (2026-09-23), así que aquí no hay forma de pago. */}
              <div className="flex items-baseline justify-between border-t border-blue-200 pt-3">
                <span className="text-sm font-medium text-blue">Total</span>
                <span className="text-3xl font-bold text-blue-700 tabular-nums">${precioTotal.toFixed(2)}</span>
              </div>
            </div>
            </div>
          );
        })()}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-4">
          <button
            type="button" onClick={() => navigate(-1)}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          {/* Sin paso de cobro: la nota se crea pendiente y se liquida desde su
              detalle, igual que Por Encargo (2026-09-23). */}
          <button
            type="button" onClick={() => handleSubmit()} disabled={loading}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading
              ? (esEdicion ? 'Guardando...' : 'Creando...')
              : (esEdicion ? 'Guardar cambios' : 'Aceptar')}
          </button>
        </div>
        </div>
        )}
        {/* ── Venta de Productos ──────────────────────────────
            Mostrador puro: qué se lleva y cuánto paga. Anónima como el
            autoservicio —el que viene a comprar un jabón no se identifica—, sin
            cargas, sin máquinas y sin nada que entregar después: al aceptar se
            cobra y la nota queda finalizada. */}
        {esVenta && (
        <div className="space-y-8">

          {bloqueProductos()}

          <Separador />

          {/* ── Resumen ──────────────────────────────────────── */}
          <div>
            <h2 className={LABEL_CLS}>Resumen</h2>
            <div className="bg-light-blue border border-blue-200 rounded-xl p-4">
              <div className="space-y-2.5 mb-3 text-sm text-blue-700">
                <div className="flex justify-between">
                  <span>Servicio</span>
                  <span className="font-medium">{TIPO_LABEL[tipoServicio]}</span>
                </div>
              </div>

              {productosLista.length > 0 && (
                <div className="space-y-2 mb-3 last:mb-0 text-sm text-blue border-t border-blue-200 pt-3">
                  <div className="flex justify-between font-medium">
                    <span>Productos</span>
                    <span>${subtotalProductos.toFixed(2)}</span>
                  </div>
                  <div className="pl-3 mt-1.5 space-y-1.5 text-xs text-blue-700/80">
                    {productosLista
                      .map(item => ({
                        item,
                        prod: productosCatalogo.find(x => String(x.id) === String(item.producto_id)),
                      }))
                      .filter(x => x.prod)
                      .sort((a, b) => ordenProducto(a.prod) - ordenProducto(b.prod))
                      .map(({ item, prod }, i) => {
                        const cant = Number(item.cantidad) || 0;
                        return (
                          <div key={i} className="flex justify-between gap-2">
                            {/* "· Granel" distingue el bidón del producto de marca
                                que se llama igual (Suavizante vs. Ensueño). */}
                            <span>
                              {etiquetaProducto(prod)}{prod.tipo_liquido === 'granel' && !esPolvo(prod) ? ' · Granel' : ''}
                              {' × '}{cant} {unidadVentaNota(prod, cant)}
                            </span>
                            <span className="flex-shrink-0">${(precioProducto(prod, 'botella') * cant).toFixed(2)}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {(ajusteNum !== 0 || form.forma_pago) && (
                <div className="space-y-2 mb-2 text-sm text-blue border-t border-blue-200 pt-3">
                  {ajusteNum !== 0 && (
                    <div className="flex justify-between">
                      <span>Ajuste</span>
                      <span>{ajusteNum > 0 ? '+' : ''}${ajusteNum.toFixed(2)}</span>
                    </div>
                  )}
                  {form.forma_pago && (
                    <div className="flex justify-between">
                      <span>Forma de pago</span>
                      <span className="font-medium">
                        {FORMAS_PAGO.find(f => f.v === form.forma_pago)?.label}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-baseline justify-between border-t border-blue-200 pt-3">
                <span className="text-sm font-medium text-blue">Total</span>
                <span className="text-3xl font-bold text-blue-700">${totalVenta.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pb-4">
            <button
              type="button" onClick={() => navigate(-1)}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button" onClick={abrirCobro} disabled={loading}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
            >
              Aceptar
            </button>
          </div>
        </div>
        )}
      </form>

      {/* Modal — elegir las máquinas de la nota de Autoservicio */}
      <ElegirMaquinasModal
        abierto={maqModalOpen}
        maquinas={maquinasLibres}
        seleccion={maqModalSel}
        cargando={loadingMaquinas}
        error={maqModalError}
        onToggle={toggleMaquinaSel}
        onConfirmar={confirmarMaquinas}
        onCancelar={() => { setMaqModalOpen(false); setMaqModalSel([]); }}
      />

      {/* Modal — cobro al momento (Autoservicio y venta de Productos) */}
      {cobroOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !loading && setCobroOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Forma de pago</h2>
                <p className="text-xs text-gray-500 mt-0.5">Se cobra al momento</p>
              </div>
              <button
                type="button"
                onClick={() => setCobroOpen(false)}
                disabled={loading}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex items-baseline justify-between bg-light-blue border border-blue-200 rounded-xl px-4 py-3">
                <span className="text-sm font-medium text-blue">Total a cobrar</span>
                <span className="text-2xl font-bold text-blue-700 tabular-nums">${(esVenta ? totalVenta : precioTotal).toFixed(2)}</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {FORMAS_PAGO.map(opt => {
                  const selected = form.forma_pago === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, forma_pago: opt.v })); setError(''); }}
                      className={`py-4 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                        selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {error}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 flex gap-3">
              <button
                type="button"
                onClick={() => setCobroOpen(false)}
                disabled={loading}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={loading || !form.forma_pago}
                className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors"
              >
                {loading
                  ? (esEdicion ? 'Guardando...' : 'Creando...')
                  : (esEdicion ? 'Guardar cambios' : 'Crear nota')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — elegir producto de una carga Por Encargo */}
      {selectorProducto && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectorProducto(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Agregar producto
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {esCarga(selectorProducto.ambito)
                    ? `Carga ${selectorProducto.carga + 1} · se cobra por medida`
                    : 'Se cobra por pieza completa'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectorProducto(null)}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-3 overflow-y-auto">
              {(() => {
                const { ambito } = selectorProducto;
                // Todo el catálogo, en cualquier servicio (2026-09-25): el
                // granel por medida, los de marca por unidad y las bolsas por
                // pieza. Lo que cambia entre servicios es la unidad, no la lista.
                const lista = productosCatalogo;
                if (lista.length === 0) {
                  return (
                    <p className="px-2 py-6 text-center text-sm text-gray-500">
                      No hay productos dados de alta.
                    </p>
                  );
                }
                // Los ya puestos no se ofrecen otra vez: para llevar más se sube
                // la cantidad del renglón que ya existe.
                const enUso = esCarga(ambito)
                  ? (encargoCargas[selectorProducto.carga]?.productos ?? [])
                  : productosLista;
                const puestos = enUso.map(p => String(p.producto_id));
                const disponibles = lista.filter(p =>
                  !puestos.includes(String(p.id)) && disponiblesDe(p, ambito) > 0);
                return (
                  <div className="space-y-1.5">
                    {disponibles.length === 0 && (
                      <p className="px-3 py-3 mb-1 text-sm text-bronce bg-light-bronce border border-bronce/30 rounded-xl">
                        {esCarga(ambito)
                          ? 'Esta carga ya lleva todos los productos disponibles. Para llevar más de alguno, sube sus medidas en la lista.'
                          : 'La nota ya lleva todos los productos disponibles. Para llevar más de alguno, sube su cantidad en la lista.'}
                      </p>
                    )}
                    {lista.map(p => {
                      const yaEsta   = puestos.includes(String(p.id));
                      const sinStock = disponiblesDe(p, ambito) <= 0;
                      const bloqueado = yaEsta || sinStock;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={bloqueado}
                          onClick={() => elegirProducto(p.id)}
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
                            <p className="text-xs text-gray-500 tabular-nums">{detalleProducto(p, ambito)}</p>
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
                onClick={() => setSelectorProducto(null)}
                className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal — crear nuevo cliente */}
      {nuevoClienteOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Nuevo cliente</h2>
              <button
                onClick={() => setNuevoClienteOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className={LABEL_CLS}>
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={nuevoCliente.nombre}
                  onChange={e => setNuevoCliente(c => ({ ...c, nombre: e.target.value }))}
                  placeholder="Nombre"
                  className={INPUT_CLS}
                  autoFocus
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Apellido</label>
                <input
                  type="text"
                  value={nuevoCliente.apellido}
                  onChange={e => setNuevoCliente(c => ({ ...c, apellido: e.target.value }))}
                  placeholder="Apellido"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Teléfono</label>
                <input
                  type="tel"
                  value={nuevoCliente.telefono}
                  onChange={e => setNuevoCliente(c => ({ ...c, telefono: e.target.value }))}
                  placeholder="Ej. 33 1234 5678"
                  className={INPUT_CLS}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setNuevoClienteOpen(false)}
                  disabled={creandoCliente}
                  className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 disabled:opacity-60 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={crearCliente}
                  disabled={creandoCliente || !nuevoCliente.nombre.trim()}
                  className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
                >
                  {creandoCliente ? 'Creando...' : 'Crear cliente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal — error al crear nota */}
      {error && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center space-y-5 animate-shake">
            <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center animate-pop-in">
              <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M6 6L18 18M18 6L6 18"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                  className="animate-draw-x"
                />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-gray-900">Ocurrió un error</h3>
              <p className="text-sm text-gray-500">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError('')}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal — éxito al crear nota */}
      {notaCreada && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center space-y-5 animate-pop-in">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center animate-pop-in">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                  style={{ strokeDasharray: 48, strokeDashoffset: 48 }}
                  className="animate-draw-check"
                />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-gray-900">{esVenta ? '¡Venta registrada!' : '¡Nota creada!'}</h3>
              {notaCreada.folio && (
                <p className="text-sm text-gray-500">
                  Folio <span className="font-semibold text-gray-800">{notaCreada.folio}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
