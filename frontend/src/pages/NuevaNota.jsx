import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { etiquetaProducto, ordenProducto, seVendePorUnidad, esPolvo } from '../lib/formatoInventario';
import { capitalizarNombre } from '../lib/texto';
import { FORMAS_PAGO, FORMAS_PAGO_COBRO, formaPagoLabel } from '../lib/formasPago';
import AbrirCajaModal from '../components/AbrirCajaModal';
import ConfirmacionModal from '../components/ConfirmacionModal';
import ModalCobrar from '../components/ModalCobrar';
import ElegirMaquinasModal, { SELECCION_EDREDON } from '../components/ElegirMaquinasModal';
import Selector from '../components/Selector';
import { cobraPorPrograma } from '../lib/tiemposModelo';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const LABEL_CLS = 'block text-sm font-semibold text-gray-900 mb-2';

/** Línea divisoria entre secciones de una pantalla. */
const Separador = () => (
  <div className="py-1"><div className="border-t border-gray-200" /></div>
);

const INPUT_DISABLED_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base bg-gray-50 text-gray-400 cursor-not-allowed placeholder:text-gray-400';

const TIPOS_SERVICIO = [
  { v: 'AUTOSERVICIO', label: 'Autoservicio' },
  { v: 'POR_ENCARGO',  label: 'Por Encargo'  },
  // Venta de productos: sin lavado; se cobra al momento y nace finalizada.
  { v: 'PRODUCTOS',    label: 'Productos'    },
];
const TIPO_LABEL = Object.fromEntries(TIPOS_SERVICIO.map(t => [t.v, t.label]));

/**
 * Cliente de mostrador (sin registrar): ocupa el lugar del id del cliente y al
 * guardar se manda como cliente_id null.
 */
const CLIENTE_MOSTRADOR = 'MOSTRADOR';

const TIPOS_PRENDA = [
  { v: 'ROPA',    label: 'Ropa'    },
  { v: 'EDREDON', label: 'Edredón' },
];
const PRENDA_LABEL = Object.fromEntries(TIPOS_PRENDA.map(t => [t.v, t.label]));

// Tipos de tela y tamaños de edredón: catálogos de Ajustes; la nota guarda el nombre.

const FORM_INIT = {
  tipo_tela:      '',
  tamano_edredon: '',
  ajuste:         '0',
  instrucciones:  '',
  referencia:     '',
  forma_pago:     '',
};

/**
 * Autoservicio elige la máquina (de las libres), así se sabe su tarifa y el
 * total. Cada renglón es una máquina (las notas viejas pueden traer dos).
 */
const MAX_CARGAS  = 20;

const TAMANOS = [
  { v: 'chico',   label: 'Chico'   },
  { v: 'mediano', label: 'Mediano' },
  { v: 'grande',  label: 'Grande'  },
  { v: 'jumbo',  label: 'Jumbo'  },
];
const TAMANO_LABEL = Object.fromEntries(TAMANOS.map(t => [t.v, t.label]));

/**
 * Servicios de Por Encargo: el precio de Ajustes ya incluye lavado, secado,
 * jabón y bolsa; cada servicio se guarda como una carga. Los de ropa son fijos;
 * los de edredón salen del catálogo de tamaños (serviciosDe).
 */
const SERVICIOS_ROPA = [
  { v: 'chico',   label: 'Chico',   tamano: 'chico',   tipo_prenda: 'ROPA' },
  { v: 'mediano', label: 'Mediano', tamano: 'mediano', tipo_prenda: 'ROPA' },
  { v: 'grande',  label: 'Grande',  tamano: 'grande',  tipo_prenda: 'ROPA' },
];
/** Ya no se venden: solo aparecen en notas que los traen, sin cambiarles precio. */
const SERVICIOS_LEGADO = [
  { v: 'edredon', label: 'Edredón', tamano: 'jumbo', tipo_prenda: 'EDREDON', legado: true },
  { v: 'jumbo',   label: 'Jumbo',   tamano: 'jumbo', tipo_prenda: 'ROPA',    legado: true },
];
const servicioEdredon = (nombre) => `edredon:${nombre}`;
/**
 * Todos los servicios, en el orden de la pantalla y el ticket. Un tamaño de
 * edredón inactivo cuenta como legado.
 */
const serviciosDe = (tamanosEdredon) => [
  ...SERVICIOS_ROPA,
  ...tamanosEdredon.map(e => ({
    v:              servicioEdredon(e.nombre),
    label:          `Edredón ${e.nombre}`,
    // Título corto para el renglón; en avisos y resúmenes, el nombre completo.
    titulo:         `E. ${e.nombre}`,
    tamano:         'jumbo',
    tipo_prenda:    'EDREDON',
    tamano_edredon: e.nombre,
    precio:         e.precio != null ? Number(e.precio) : null,
    legado:         !e.activo,
  })),
  ...SERVICIOS_LEGADO,
];
// Cuántos servicios del mismo tipo caben en una nota.
const MAX_SERVICIOS = 20;

/** Muestra el detalle por servicio (tipo de tela, tamaño de edredón); oculto. */
const MOSTRAR_DETALLE_SERVICIO = false;

/**
 * Datos de la nota. La prenda, el tamaño y el material de cada servicio viven
 * en sus cargas (encargoCargas).
 */
const ENCARGO_INIT = {
  cliente_id:      '',
  pago_anticipado: '',
  forma_pago:      '',
  // Anticipo: menos que el total deja la nota abonada; el total, pagada.
  monto_anticipo:  '',
  fecha_entrega:   '',
  tiempo_entrega:  '',
  instrucciones:   '',
  ajuste:          '0',
};

/**
 * Un servicio Por Encargo (se guarda como carga). La máquina se asigna en
 * Salidas sin cambiar el cobro. `ajuste` va en 0: el ajuste es de la nota.
 */
const CARGA_ENCARGO_INIT = {
  servicio:               '',
  tipo_prenda:            '',
  tipo_tela:              '',
  tamano_edredon:         '',
  tamano:                 '',
  ajuste:                 '0',
  productos:              [],
  // Medidas de granel cambiadas a mano: { tipoId: n }; las demás, de Ajustes.
  granel:                 {},
};

/** Día en que estará lista la ropa (opcional). */
const TIEMPOS_ENTREGA = [
  { v: 'MANANA',   label: 'Mañana'    },
  { v: 'DOS_DIAS', label: 'En 2 días' },
  // "Otra" abre el calendario: la fecha va en fecha_entrega.
  { v: 'OTRA',     label: 'Otra'      },
];
const TIEMPO_ENTREGA_LABEL = Object.fromEntries(TIEMPOS_ENTREGA.map(t => [t.v, t.label]));

/** Fecha local YYYY-MM-DD a `dias` de hoy (por defecto, hoy). */
const fechaISOEnDias = (dias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fechaHoyISO = () => fechaISOEnDias(0);
/** Fecha de entrega según el día prometido: hoy + 1, hoy + 2 o la elegida. */
const fechaSegunDiaPrometido = (tiempo, fechaElegida) => {
  if (tiempo === 'MANANA')   return fechaISOEnDias(1);
  if (tiempo === 'DOS_DIAS') return fechaISOEnDias(2);
  return fechaElegida || fechaHoyISO();
};

/** Pasos: Cliente, Servicios, Entrega y Resumen (con el pago). */
const ENCARGO_STEPS = 4;
const PASO_SERVICIOS = 2;
const PASO_ENTREGA   = 3;
const PASO_RESUMEN   = 4;

export default function NuevaNota() {
  const navigate = useNavigate();
  // Máquinas libres del modal; se piden al abrirlo.
  const [maquinasLibres,    setMaquinasLibres]    = useState([]);
  const [productosCatalogo, setProductosCatalogo] = useState([]);
  const [telas,             setTelas]             = useState([]);
  const [tamanosEdredon,    setTamanosEdredon]    = useState([]);
  const [precios,           setPrecios]           = useState({ mediana: 70, jumbo: 70, secadora: 45, secadoraJumbo: 45, edredon: 80 });
  // Precio de cada servicio (Ajustes); null = sin configurar.
  const [topes,             setTopes]             = useState({ chico: null, mediano: null, grande: null, jumbo: null, edredon: null });
  // Lo que trae puesto cada servicio de ropa (los de edredón, en su catálogo).
  const [precargas,         setPrecargas]         = useState({});
  // Tipos de granel (Jabón, Suavizante…).
  const [tiposGranel,       setTiposGranel]       = useState([]);
  const [loadingData,       setLoadingData]       = useState(true);
  // Caja del día: si no está abierta, se avisa.
  const [cajaAbierta, setCajaAbierta] = useState(null);
  const [modalCajaOpen, setModalCajaOpen] = useState(false);
  // Pago anticipado de Por Encargo: abre el modal de Cobrar.
  const [anticipoOpen,  setAnticipoOpen]  = useState(false);
  const [anticipoMonto, setAnticipoMonto] = useState('');
  const [anticipoForma, setAnticipoForma] = useState('');
  const [form,              setForm]              = useState(FORM_INIT);
  const [productosLista,    setProductosLista]    = useState([]);
  const [error,             setError]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [tipoServicio,      setTipoServicio]      = useState('');
  // Venta de productos: sin cargas, se cobra al momento.
  const esVenta = tipoServicio === 'PRODUCTOS';
  const [tipoOpen,          setTipoOpen]          = useState(false);
  // Máquinas de Autoservicio, una por renglón: { id?, lavadora, secadora }
  // (`id` solo al editar). Se agregan desde el modal.
  const [cargasAuto,        setCargasAuto]        = useState([]);
  // Modal de elegir máquinas (como "Asignar máquina" de Salidas).
  const [maqModalOpen,      setMaqModalOpen]      = useState(false);
  const [maqModalSel,       setMaqModalSel]       = useState([]);
  const [maqModalError,     setMaqModalError]     = useState('');
  const [loadingMaquinas,   setLoadingMaquinas]   = useState(false);
  const [encargoStep,       setEncargoStep]       = useState(1);
  const [encargoForm,       setEncargoForm]       = useState(ENCARGO_INIT);
  // Arranca sin servicios; cada uno nace con su material.
  const [encargoCargas,     setEncargoCargas]     = useState([]);
  const [encargoLoading,    setEncargoLoading]    = useState(false);
  const [clientes,          setClientes]          = useState([]);
  const [clienteSearch,     setClienteSearch]     = useState('');
  const [nuevoClienteOpen,  setNuevoClienteOpen]  = useState(false);
  // Selector de producto: `ambito` 'nota' (por botella) o 'carga' (por medida,
  // con `carga`). Un producto puesto no se cambia: se borra y se agrega otro.
  const [selectorProducto,  setSelectorProducto]  = useState(null);
  // Producto que ya no cabe en el tope al tocar su "+"; el aviso de abajo no se ve desde ahí.
  const [avisoTope,         setAvisoTope]         = useState(null);
  // La venta de productos se cobra al momento: "Aceptar" abre este modal.
  const [cobroOpen,         setCobroOpen]         = useState(false);
  const [nuevoCliente,      setNuevoCliente]      = useState({ nombre: '', apellido: '', telefono: '' });
  const [creandoCliente,    setCreandoCliente]    = useState(false);
  const [folio,             setFolio]             = useState('');
  const [notaCreada,        setNotaCreada]        = useState(null);
  const tipoRef           = useRef(null);

  // El aviso de nota creada corre su animación (~0.6 s) y, sin pedir confirmación,
  // abre lo siguiente.
  useEffect(() => {
    if (!notaCreada) return;
    // Autoservicio y Por Encargo van a Salidas (encender máquina, elegir granel);
    // la venta de productos, al detalle.
    const SERVICIOS_A_SALIDAS = ['AUTOSERVICIO', 'POR_ENCARGO'];
    const destino = !notaCreada.id
      ? '/notas'
      : SERVICIOS_A_SALIDAS.includes(notaCreada.tipo_servicio)
        ? `/notas/${notaCreada.id}/salidas`
        : `/notas/${notaCreada.id}`;
    const t = setTimeout(() => {
      setNotaCreada(null);
      // replace: "atrás" no regresa al formulario ya enviado (evita duplicar la nota).
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
  // Secado: precio único.
  const precioSecado = () => precios.secadora;
  // Precio por tipo de lavadora en Por Encargo.
  const precioLavadoTipo = (tipo, prenda) =>
    tipo === 'jumbo'   ? precioPorTipo('lavadora_jumbo', prenda)
    : tipo === 'mediana' ? precioPorTipo('lavadora_mediana', prenda)
    : 0;
  const precioSecadoTipo = (tipo, prenda) => (tipo ? precioSecado(tipo, prenda) : 0);
  // Lo que cobra una máquina de Autoservicio, con la misma tarifa que el servidor.
  const precioDeMaquina = (m) => {
    if (!m) return 0;
    // La que cobra por programa (Sec49) queda por definir: $0 hasta iniciarla.
    if (m.tipo === 'secadora' && tipoServicio === 'AUTOSERVICIO' && cobraPorPrograma(m)) return 0;
    if (m.tipo === 'secadora') return precioSecado();
    return precioPorTipo(m.tipo === 'lavadora_jumbo' ? 'lavadora_jumbo' : 'lavadora_mediana', 'ROPA');
  };
  // Un renglón es una máquina (las notas viejas pueden traer dos). El "Edredón"
  // cobra su tarifa, con lavadora o sin ella.
  const esEdredonAuto = (c) => String(c?.tipo_prenda ?? '').toUpperCase() === 'EDREDON';
  const subtotalDeCarga = (c) => esEdredonAuto(c)
    ? (Number(precios.edredon) || 0) + precioDeMaquina(c.secadora)
    : precioDeMaquina(c.lavadora) + precioDeMaquina(c.secadora)
    // Carga vieja con tipo y sin máquina: se cobra por su tipo.
    + (c.lavadora ? 0 : precioLavadoTipo(c.lavadora_tipo, 'ROPA'))
    + (c.secadora ? 0 : precioSecadoTipo(c.secadora_tipo, 'ROPA'));
  // Secadora por definir: su precio sale del tiempo que se elija al iniciarla.
  const secadoraPorDefinir = (c) => tipoServicio === 'AUTOSERVICIO' && cobraPorPrograma(c?.secadora);
  const hayPorDefinir = () => cargasAuto.some(secadoraPorDefinir);
  /** Lo que cobra el renglón: "Por definir" si solo es la secadora que aún no tiene precio. */
  const montoRenglon = (c) => {
    const sub = subtotalDeCarga(c);
    if (!secadoraPorDefinir(c)) return `$${sub.toFixed(2)}`;
    return sub > 0 ? `$${sub.toFixed(2)} + por definir` : 'Por definir';
  };
  // Máquinas que la nota ya tiene: no se vuelven a ofrecer.
  const maquinasElegidas = cargasAuto.flatMap(c =>
    [c.lavadora?.id, c.secadora?.id].filter(Boolean).map(String));
  // Qué es la máquina, sin nombrarla ("Lavadora Mediana"): el resumen habla de
  // lo que se cobra.
  const tipoDeRenglon = (c) => {
    if (esEdredonAuto(c)) return 'Edredón';
    const partes = [];
    if (c.lavadora) partes.push(`Lavadora ${c.lavadora.tipo === 'lavadora_jumbo' ? 'Jumbo' : 'Mediana'}`);
    if (c.secadora) partes.push('Secadora');
    if (partes.length === 0 && c.lavadora_tipo) partes.push('Lavadora (sin asignar)');
    if (partes.length === 0 && c.secadora_tipo) partes.push('Secadora (sin asignar)');
    return partes.join(' + ');
  };
  // Título del renglón con el nombre ("L3 · Mediana"): es la que hay que cargar.
  const etiquetaRenglon = (c) => {
    // Edredón: "Edredón" hasta tener lavadora; luego "L8 · Edredón".
    if (esEdredonAuto(c)) return c.lavadora ? `${c.lavadora.nombre} · Edredón` : 'Edredón';
    const partes = [];
    if (c.lavadora) partes.push(`${c.lavadora.nombre} · ${c.lavadora.tipo === 'lavadora_jumbo' ? 'Jumbo' : 'Mediana'}`);
    if (c.secadora) partes.push(`${c.secadora.nombre} · Secadora`);
    if (partes.length === 0 && c.lavadora_tipo) partes.push('Lavadora (sin asignar)');
    if (partes.length === 0 && c.secadora_tipo) partes.push('Secadora (sin asignar)');
    return partes.join(' + ');
  };
  // El ajuste de nota solo existe en una venta vieja que se reabra.
  const ajusteNum      = esVenta ? (Number(form.ajuste) || 0) : 0;
  // Precio según la unidad: botella (precio_botella) o medida (precio_unitario).
  const precioProducto = (prod, unidad = 'medida') => {
    if (!prod) return 0;
    if (prod.clase === 'bolsa') return Number(prod.precio_unitario) || 0; // por pieza
    return unidad === 'botella'
      ? (Number(prod.precio_botella) || 0)
      : (Number(prod.precio_unitario) || 0);
  };
  // Botellas disponibles (la existencia viene en medidas).
  const botellasDisponibles = (prod) => {
    if (!prod) return 0;
    const tpb = Number(prod.medidas_por_botella) || 0;
    const disp = Number(prod.stock_disponible ?? prod.stock_actual) || 0;
    return tpb > 0 ? Math.floor(disp / tpb) : disp;
  };
  // Unidad vendida en Autoservicio: botella (granel), pieza (marca y polvo) o bolsa.
  const unidadVentaNota = (prod, n = 2) => {
    if (prod?.clase === 'bolsa') return n === 1 ? 'bolsa' : 'bolsas';
    if (seVendePorUnidad(prod)) return n === 1 ? 'pieza' : 'piezas';
    return n === 1 ? 'botella' : 'botellas';
  };
  // Granel de los servicios Por Encargo: N medidas de cada tipo; el producto se
  // elige en Salidas y lo pone el servidor. Aquí solo se muestra y se avisa si
  // no alcanza.
  const medidasDisponibles = (p) => Number(p.stock_disponible ?? p.stock_actual) || 0;
  // Solo el granel líquido con tipo (el polvo se vende por unidad).
  const granelServido = (p) => p.tipo_liquido === 'granel' && !esPolvo(p) && p.tipo_granel_id != null;
  // Productos por tipo de granel.
  const granelPorTipo = () => {
    const porTipo = new Map();
    for (const p of productosCatalogo) {
      if (!granelServido(p)) continue;
      if (!porTipo.has(p.tipo_granel_id)) porTipo.set(p.tipo_granel_id, []);
      porTipo.get(p.tipo_granel_id).push(p);
    }
    return porTipo;
  };
  const nombreTipo = (tipoId) => tiposGranel.find(t => t.id === tipoId)?.nombre ?? 'granel';
  const ordenTipo  = (tipoId) => tiposGranel.findIndex(t => t.id === tipoId);
  const subtotalCargas = cargasAuto.reduce((s, c) => s + subtotalDeCarga(c), 0);
  // Productos de la nota: pieza completa en Autoservicio y venta; en Por Encargo,
  // granel por medida.
  const ambitoProductosNota = tipoServicio === 'POR_ENCARGO' ? 'encargo' : 'nota';
  // La unidad se resuelve aquí: precioEnAmbito se define más abajo.
  const precioProductoNota = (prod) => precioProducto(
    prod,
    ambitoProductosNota === 'encargo' && prod?.tipo_liquido === 'granel'
      && prod?.clase !== 'bolsa' && !esPolvo(prod)
      ? 'medida' : 'botella'
  );
  // En Por Encargo, el granel (por medida) y las bolsas son material del servicio
  // (gastan de su precio); marca y polvo se cobran encima. En los demás servicios
  // todo producto se cobra.
  const esMaterialDeNota = (prod) =>
    tipoServicio === 'POR_ENCARGO' && !seVendePorUnidad(prod);
  // Bolsas de ese producto que incluyen los servicios (Ajustes); las de más se
  // cobran (como el servidor, que las congela al crear la nota).
  const bolsasIncluidasNota = (prod) => (tipoServicio === 'POR_ENCARGO' && prod?.clase === 'bolsa'
    ? encargoCargas.reduce((s, c) => {
        // Servicio y clave como SERVICIO_POR_V y servicioBolsa, que se declaran más abajo.
        const sv = serviciosDe(tamanosEdredon).find(x => x.v === c.servicio);
        const clave = String(c.tipo_prenda).toUpperCase() === 'EDREDON' ? 'edredon'
          : ['chico', 'mediano', 'grande'].includes(c.tamano) ? c.tamano : null;
        if (!sv || !clave || !(prod.servicios_bolsa ?? []).includes(clave)) return s;
        return s + precargaDeServicio(sv).bolsas;
      }, 0)
    : 0);
  /** Piezas de un renglón que se cobran: todas, salvo el material (y la bolsa, solo las de más). */
  const cantidadCobrada = (prod, cant) => {
    if (!esMaterialDeNota(prod)) return cant;
    if (prod?.clase === 'bolsa') return Math.max(0, cant - bolsasIncluidasNota(prod));
    return 0;
  };
  const sumaProductosNota = (parte) => productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    if (!prod) return sum;
    const cant = Number(p.cantidad) || 0;
    const cobradas = cantidadCobrada(prod, cant);
    return sum + precioProductoNota(prod) * (parte === 'cobrado' ? cobradas : cant - cobradas);
  }, 0);
  // Lo que se cobra de los productos de la nota.
  const subtotalProductos = sumaProductosNota('cobrado');
  // Lo que gasta del precio de los servicios: todo lo servido, también las bolsas
  // de más (se cobran aparte, pero cuentan contra el tope; como el servidor).
  const materialProductosNota = productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    if (!prod || !esMaterialDeNota(prod)) return sum;
    return sum + precioProductoNota(prod) * (Number(p.cantidad) || 0);
  }, 0);
  const precioTotal = subtotalCargas + ajusteNum + subtotalProductos;
  // La venta de productos: sus productos y el ajuste.
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
      api.get('/etiquetas/tipos-granel'),
    ];
    // Esta pantalla solo crea notas.
    promesas.push(api.get('/notas/next-folio'));

    Promise.all(promesas)
      .then((resultados) => {
        const [prod, cfg, cli, telasCat, tamanosCat, tiposCat, extra] = resultados;
        setTelas(telasCat || []);
        setTamanosEdredon(tamanosCat || []);
        setTiposGranel(tiposCat || []);
        setFolio(extra?.folio ?? '');
        // La lista de máquinas la pide el modal al abrirse.
        setProductosCatalogo(prod);
        if (cfg) {
          setPrecios({
            mediana:         cfg.precio_carga_mediana    != null ? Number(cfg.precio_carga_mediana)    : 70,
            jumbo:           cfg.precio_carga_jumbo      != null ? Number(cfg.precio_carga_jumbo)      : 70,
            // precio_carga_secadora es la secadora mediana.
            secadora:        cfg.precio_carga_secadora   != null ? Number(cfg.precio_carga_secadora)   : 45,
            secadoraJumbo:   cfg.precio_secadora_jumbo   != null ? Number(cfg.precio_secadora_jumbo)   : 45,
            // El "Edredón" de Autoservicio: su tarifa, en cualquier lavadora.
            edredon:         cfg.precio_edredon_jumbo    != null ? Number(cfg.precio_edredon_jumbo)    : 80,
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
      })
      .finally(() => setLoadingData(false));
  }, []);

  const agregarProducto = (productoId = '') =>
    setProductosLista(prev => [...prev, { producto_id: String(productoId), cantidad: '1' }]);

  const actualizarProducto = (i, field, value) =>
    setProductosLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarProducto = (i) =>
    setProductosLista(prev => prev.filter((_, idx) => idx !== i));

  // Quita una máquina; la numeración sale del índice.
  const eliminarCargaAuto = (i) =>
    setCargasAuto(prev => prev.filter((_, idx) => idx !== i));

  // ── Elegir máquinas (modal) ─────────────────────────────
  // Se piden al abrir el modal: importa lo que está libre ahora.
  const abrirSelectorMaquinas = async () => {
    setMaqModalSel([]);
    setMaqModalError('');
    setMaqModalOpen(true);
    setLoadingMaquinas(true);
    try {
      const data = await api.get('/maquinas');
      // Solo las libres de verdad: ni en uso, ni en mantenimiento, ni apuntadas en
      // otra nota abierta (aquí ya se cobra por ella), ni las que ya tiene esta nota.
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

  // Cada máquina marcada es un renglón propio, con su tarifa.
  const confirmarMaquinas = () => {
    const elegidas = maqModalSel
      .map(id => (String(id) === SELECCION_EDREDON
        // El Edredón entra sin máquina: la lavadora se asigna en Salidas.
        ? { lavadora: null, secadora: null, lavadora_tipo: 'jumbo', secadora_tipo: '', tipo_prenda: 'EDREDON' }
        : maquinasLibres.find(m => String(m.id) === String(id))))
      .filter(Boolean)
      .map(m => (m.tipo_prenda ? m
        : m.tipo === 'secadora'
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
  // La cuenta sale de las cargas, no de un contador aparte.
  const cuentaServicio = (serv) => encargoCargas.filter(c => c.servicio === serv).length;
  // Con contador: los que se venden, y los de legado si la nota los trae.
  const serviciosVisibles = SERVICIOS.filter(s => !s.legado || cuentaServicio(s.v) > 0);
  // Precio del servicio (Ajustes); null = sin precio, no se puede vender.
  const precioServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    if (s && 'precio' in s) return s.precio;  // tamaño de edredón: su catálogo
    return topes[serv] ?? null;
  };

  // Un servicio nace vacío: su material (bolsa) va a la lista de productos de la
  // nota, junto con lo que compre el cliente.
  const nuevoServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    return {
      ...CARGA_ENCARGO_INIT, servicio: serv, tamano: s.tamano, tipo_prenda: s.tipo_prenda,
      tamano_edredon: s.tamano_edredon ?? '',
    };
  };

  // Material que pone un servicio: su bolsa, en la cantidad de Ajustes (o las que
  // haya). El granel se elige en Salidas.
  const materialDeServicio = (serv) => {
    const s = SERVICIO_POR_V[serv];
    const { bolsas } = precargaDeServicio(s);
    const bolsa = bolsaDeCargaConStock({ tamano: s.tamano, tipo_prenda: s.tipo_prenda });
    const nBolsas = bolsa ? Math.min(bolsas, Number(bolsa.stock_disponible ?? bolsa.stock_actual) || 0) : 0;
    return nBolsas > 0 ? [{ producto_id: String(bolsa.id), cantidad: String(nBolsas) }] : [];
  };

  // Medidas de un tipo de granel en un servicio: las cambiadas aquí o las de Ajustes.
  const llevaGranel = (c) => Boolean(SERVICIO_POR_V[c.servicio] && servicioBolsa(c));
  const medidasGranel = (c, tipoId) => {
    if (!llevaGranel(c)) return 0;
    return c.granel?.[tipoId] ?? precargaDeServicio(SERVICIO_POR_V[c.servicio]).medidas;
  };
  const setMedidasGranel = (idx, tipoId, n) =>
    setEncargoCargas(prev => prev.map((c, i) => (i === idx
      ? { ...c, granel: { ...(c.granel ?? {}), [tipoId]: Math.max(0, n) } }
      : c)));

  // Granel de la nota por tipo: total, opciones y si alcanza. Que no alcance no
  // impide crear la nota: solo se avisa.
  const resumenGranel = () => {
    const servicios = encargoCargas
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => llevaGranel(c));
    if (servicios.length === 0) return [];
    const etiqueta = ({ c }) => {
      const nombre = SERVICIO_POR_V[c.servicio]?.label ?? 'Servicio';
      const mismos = servicios.filter(x => x.c.servicio === c.servicio);
      return mismos.length > 1 ? `${nombre} ${mismos.findIndex(x => x.c === c) + 1}` : nombre;
    };
    return [...granelPorTipo().entries()]
      .sort(([a], [b]) => ordenTipo(a) - ordenTipo(b))
      .map(([tipoId, opciones]) => {
        const filas = servicios.map(sv => ({ ...sv, etiqueta: etiqueta(sv), medidas: medidasGranel(sv.c, tipoId) }));
        const total = filas.reduce((sum, f) => sum + f.medidas, 0);
        const quedan = opciones.reduce((sum, p) => sum + medidasDisponibles(p), 0);
        return { tipoId, nombre: nombreTipo(tipoId), filas, total, opciones, quedan };
      });
  };
  // Medidas de granel y bolsas que trae puestas un servicio (Ajustes).
  function precargaDeServicio(s) {
    if (s.tamano_edredon) {
      const e = tamanosEdredon.find(x => x.nombre === s.tamano_edredon);
      return { medidas: Number(e?.precarga_medidas ?? 0), bolsas: Number(e?.precarga_bolsas ?? 0) };
    }
    return precargas[s.v] ?? { medidas: 0, bolsas: 0 };
  }

  // Suma (o resta, con `veces` negativo) el material de un servicio a la lista;
  // un renglón en cero desaparece.
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

  // Deja N servicios de un tipo, conservando los que estaban y en el orden de
  // SERVICIOS; ajusta su material en la lista.
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
      // Una carga sin servicio reconocible (muy vieja) se queda al final.
      return [
        ...SERVICIOS.flatMap(s => juntos.filter(c => c.servicio === s.v)),
        ...juntos.filter(c => !SERVICIO_POR_V[c.servicio]),
      ];
    });
    ajustarMaterial(serv, objetivo - actuales);
  };

  const actualizarCargaEncargo = (i, cambios) =>
    setEncargoCargas(prev => prev.map((c, idx) => (idx === i ? { ...c, ...cambios } : c)));

  // Diferencias entre ámbitos: Por Encargo cobra por medida; Autoservicio por
  // botella o pieza.
  const esCarga        = (ambito) => ambito === 'carga';
  // Los productos de una nota Por Encargo se cobran con la regla de los servicios
  // (granel por medida, marca por unidad), igual que en el servidor.
  const porMedidaEnAmbito = (ambito) => ambito === 'carga' || ambito === 'encargo';
  // Marca y polvo se venden por unidad en todas partes.
  const porMedida = (prod, ambito) =>
    porMedidaEnAmbito(ambito) && prod?.tipo_liquido === 'granel'
    && prod?.clase !== 'bolsa' && !esPolvo(prod);
  const precioEnAmbito = (prod, ambito) => precioProducto(prod, porMedida(prod, ambito) ? 'medida' : 'botella');
  const unidadEnAmbito = (prod, ambito, n = 2) => (porMedida(prod, ambito)
    ? (n === 1 ? 'medida' : 'medidas')
    : unidadVentaNota(prod, n));
  // Disponibles: medidas si se sirve por medida; envases si se vende por unidad.
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

  // Agrega el producto elegido. En Por Encargo el material del servicio no se
  // elige aquí: esto es lo que compra el cliente.
  const elegirProducto = (productoId) => {
    if (!selectorProducto) return;
    agregarProducto(productoId);
    setSelectorProducto(null);
  };

  const crearCliente = async () => {
    const nombre = capitalizarNombre(nuevoCliente.nombre);
    if (!nombre || !nuevoCliente.telefono.trim()) return;
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

  // Cliente → Servicios → Entrega → Resumen (con el pago al final, que es cuando
  // se cobra y se crea la nota). Servicios, ajuste y productos van en una pantalla.
  const nCargas     = encargoCargas.length;
  const pasoEntrega = PASO_ENTREGA;
  const pasoResumen = PASO_RESUMEN;

  // Precio de un producto dentro de una carga: granel por medida; marca y polvo
  // por unidad, cobrados encima del tope.
  const esProductoMarca = (prod) => seVendePorUnidad(prod);
  const precioProductoCarga = (prod) =>
    precioProducto(prod, esProductoMarca(prod) ? 'botella' : 'medida');
  const sumaProductosCarga = (lista, cuenta = () => true) => (lista ?? []).reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    if (!prod || !cuenta(prod)) return sum;
    return sum + precioProductoCarga(prod) * (Number(p.cantidad) || 0);
  }, 0);
  // Contra el tope cuenta lo servido dentro (granel y bolsa); la marca va encima.
  const subtotalAbsorbidoLista = (lista) => sumaProductosCarga(lista, p => !esProductoMarca(p));
  const subtotalMarcaLista     = (lista) => sumaProductosCarga(lista, esProductoMarca);

  // ── Bolsas (Por Encargo): la ligada al servicio, tantas como diga Ajustes ──
  const bolsasCatalogo = productosCatalogo.filter(p => p.clase === 'bolsa');
  // Clave del servicio de la carga para ligar bolsa y granel (cada bolsa dice a
  // qué servicios va). Todo edredón usa 'edredon'.
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
  // Existencia de una bolsa (piezas); sin existencia no se incluye y se avisa.
  const bolsaTieneStock = (b) => b && Number(b.stock_disponible ?? b.stock_actual) > 0;
  // La bolsa del servicio de la carga, si queda existencia.
  const bolsaDeCargaConStock = (c) => {
    const b = bolsaDeCarga(c);
    return bolsaTieneStock(b) ? b : null;
  };

  // Precio (tope) de la carga según Ajustes; null = sin configurar.
  const topeDeCarga  = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') {
      // Por tamaño de edredón; sin tamaño, el precio único.
      if (!c.tamano_edredon) return topes.edredon ?? null;
      const nombre = String(c.tamano_edredon).trim().toLowerCase();
      const e = tamanosEdredon.find(x => String(x.nombre).trim().toLowerCase() === nombre);
      return e?.precio != null ? Number(e.precio) : null;
    }
    return c?.tamano ? (topes[c.tamano] ?? null) : null;
  };

  // Costo de las máquinas de un servicio: Chico, Mediano y Grande usan lavadora y
  // secadora medianas; el Edredón, la lavadora jumbo (su secado no cuenta).
  const costoMaquinasServicio = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') return precios.jumbo;
    if (c?.tamano === 'jumbo')  return precios.jumbo + precios.secadora;
    if (['chico', 'mediano', 'grande'].includes(c?.tamano)) return precios.mediana + precios.secadora;
    return 0;
  };

  // Costo interno de la carga: máquinas + material servido (granel y bolsa). Se
  // compara contra el tope; el ajuste no cuenta. Una nota vieja usa su precio guardado.
  // Granel del servicio: el producto se elige en Salidas, así que sus medidas
  // cuentan al precio del más caro de su tipo (como el servidor): si así cabe,
  // cabe con cualquiera.
  const granelContraTope = (c) => [...granelPorTipo().entries()].reduce((sum, [tipoId, opciones]) => {
    const masCaro = Math.max(0, ...opciones.map(p => Number(p.precio_unitario) || 0));
    return sum + medidasGranel(c, tipoId) * masCaro;
  }, 0);
  // Sin tope (servicios viejos) esto es su precio: ahí el granel aún no se cobra.
  const usadoContraTope = (c, conGranel = true) => {
    const elegidas = precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda)
      + precioSecadoTipo(c.secadora_tipo, c.tipo_prenda);
    return (elegidas > 0 ? elegidas : costoMaquinasServicio(c))
      + subtotalAbsorbidoLista(c.productos) + (conGranel ? granelContraTope(c) : 0);
  };

  // Precio cobrado por una carga: el tope (o, sin tope, la suma real), más lo que
  // se vende por unidad y el ajuste.
  const subtotalCargaEncargo = (c) => {
    const tope = topeDeCarga(c);
    const base = tope != null ? Number(tope) : usadoContraTope(c, false);
    return base + subtotalMarcaLista(c.productos) + (Number(c.ajuste) || 0);
  };
  // Ajuste de la nota: descuento (negativo) o cargo extra (positivo). Va antes
  // porque entra en el presupuesto.
  const ajusteEncargo       = Number(encargoForm.ajuste) || 0;
  // Lo que suman los servicios, sin productos sueltos ni ajuste.
  const subtotalServicios   = encargoCargas.reduce((s, c) => s + subtotalCargaEncargo(c), 0);
  // Presupuesto de material de la nota: lo que se cobra por los servicios. Todo
  // el material sale de aquí.
  const presupuestoServicios = encargoCargas.reduce((s, c) => {
    const tope = topeDeCarga(c);
    return s + (tope != null ? Number(tope) : 0);
  }, 0);
  const materialUsado = encargoCargas.reduce((s, c) => s + usadoContraTope(c), 0)
    + materialProductosNota;
  // El ajuste cambia lo que se cobra, así que se suma (con su signo) al presupuesto.
  const presupuestoConAjuste = presupuestoServicios + ajusteEncargo;
  // Cuánto se pasa (0 o menos = cabe).
  const excesoDeLaNota = presupuestoServicios > 0 ? materialUsado - presupuestoConAjuste : 0;
  const encargoPrecioTotal  = subtotalServicios + subtotalProductos + ajusteEncargo;

  /** Por Encargo: ¿otra pieza de este producto cabe en lo que se cobra por los servicios? */
  const cabeOtraDe = (prod) => !prod || !esMaterialDeNota(prod) || presupuestoServicios <= 0
    || materialUsado + precioProductoNota(prod) <= presupuestoConAjuste + 1e-9;
  const unidadDeTope = (prod) => (prod?.clase === 'bolsa' ? 'bolsa' : 'medida');

  const excesoDeCarga = (c) => {
    const tope = topeDeCarga(c);
    return tope != null ? usadoContraTope(c) - tope : 0;
  };
  const esClienteMostrador = encargoForm.cliente_id === CLIENTE_MOSTRADOR;
  const clienteSeleccionado = clientes.find(c => String(c.id) === String(encargoForm.cliente_id));
  const sinAcentos = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const clienteSearchQ    = sinAcentos(clienteSearch.trim());
  // Coincide si una palabra del nombre o apellido EMPIEZA con la búsqueda; el
  // teléfono, por subcadena.
  const empiezaAlgunaPalabra = (texto) =>
    sinAcentos(texto).split(/\s+/).some(w => w.startsWith(clienteSearchQ));
  const clientesFiltrados = clienteSearchQ
    ? clientes.filter(c =>
        empiezaAlgunaPalabra(`${c.nombre ?? ''} ${c.apellido ?? ''}`) ||
        sinAcentos(c.telefono).includes(clienteSearchQ)
      )
    : clientes;

  // Servicios sin precio en Ajustes: no se pueden vender (el servidor también los rechaza).
  const serviciosSinPrecio = SERVICIOS.filter(s => cuentaServicio(s.v) > 0 && precioServicio(s.v) == null);

  const encargoPuedeAvanzar = (() => {
    if (encargoStep === 1) return !!encargoForm.cliente_id;
    if (encargoStep === PASO_SERVICIOS) {
      if (nCargas < 1) return false;
      if (serviciosSinPrecio.length > 0) return false;
      // Material de un servicio que cuesta más de lo que se cobra (como el servidor).
      if (encargoCargas.some(c => excesoDeCarga(c) > 0)) return false;
      // Todo el material contra lo que cobran los servicios.
      if (excesoDeLaNota > 0) return false;
      // El ajuste no puede dejar la nota en negativo.
      if (encargoPrecioTotal < 0) return false;
      return true;
    }
    return true;
  })();

  // El pago se captura en el último paso; si fue anticipado, hace falta la forma.
  const pagoCapturado = Boolean(encargoForm.pago_anticipado)
    && (encargoForm.pago_anticipado !== 'SI' || Boolean(encargoForm.forma_pago));

  // El anticipo se compara con el total actual: si ya no cubre, queda de abono.
  const anticipoNum = Number(encargoForm.monto_anticipo);
  const anticipoParcial = encargoForm.pago_anticipado === 'SI'
    && encargoForm.monto_anticipo !== ''
    && Number.isFinite(anticipoNum) && anticipoNum > 0
    && anticipoNum < encargoPrecioTotal - 1e-9;

  // "Sí" abre el cobro vacío; "Cambiar" lo abre con lo capturado.
  const abrirAnticipo = () => {
    setAnticipoMonto(encargoForm.monto_anticipo !== ''
      ? String(Math.min(Number(encargoForm.monto_anticipo), encargoPrecioTotal))
      : '');
    setAnticipoForma(encargoForm.forma_pago || '');
    setAnticipoOpen(true);
  };

  const confirmarAnticipo = () => {
    setEncargoForm(f => ({
      ...f, pago_anticipado: 'SI', forma_pago: anticipoForma, monto_anticipo: anticipoMonto,
    }));
    setAnticipoOpen(false);
  };

  const handleEncargoSubmit = async () => {
    setError('');
    if (!pagoCapturado) {
      setError(encargoForm.pago_anticipado
        ? 'Elige la forma de pago.'
        : 'Indica si hay pago anticipado.');
      return;
    }
    // Servicio sin precio: se dice antes y con su nombre.
    if (serviciosSinPrecio.length > 0) {
      setError(`Falta el precio de: ${serviciosSinPrecio.map(s => s.label).join(', ')}. `
        + 'Configúralo en Ajustes → Servicios Por Encargo.');
      return;
    }
    // Todo el material contra lo que cobran los servicios, con los números a la vista.
    if (excesoDeLaNota > 0) {
      setError(`El material de la nota suma $${materialUsado.toFixed(2)} y los servicios `
        + `se cobran en $${presupuestoConAjuste.toFixed(2)}`
        + (ajusteEncargo !== 0 ? ' (ya con el ajuste). ' : '. ')
        + `Baja $${excesoDeLaNota.toFixed(2)}: quita productos o sirve menos.`);
      return;
    }
    // Material que cuesta más que su servicio.
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
        // Sin tipo de máquina: la máquina se asigna en Salidas.
        lavadora_tipo:  null,
        secadora_tipo:  null,
        activar:        false,
        // Ajuste por carga: solo el de una nota vieja que lo traía.
        ajuste:         Number(c.ajuste) || 0,
        // El material va dentro del servicio: lo absorbe su precio.
        productos:      (c.productos ?? [])
          .filter(p => p.producto_id && p.cantidad)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
        // Medidas de cada tipo de granel; el producto se elige en Salidas.
        granel:         llevaGranel(c)
          ? [...granelPorTipo().keys()].map(t => ({ tipo_granel_id: t, cantidad: medidasGranel(c, t) }))
          : null,
      }));
      const payload = {
        tipo_servicio:      'POR_ENCARGO',
        // Prenda de la nota (lista y etiqueta): la de la primera carga.
        tipo_prenda:    encargoCargas[0]?.tipo_prenda || 'ROPA',
        // Mostrador va sin cliente; el teléfono se captura desde el ticket si hace falta.
        cliente_id:     esClienteMostrador ? null : Number(encargoForm.cliente_id),
        cargas:         cargasPayload,
        ajuste:         ajusteEncargo,
        // Lo que el cliente compra aparte: va a la nota y se cobra encima.
        productos:      productosLista
          .filter(p => p.producto_id && p.cantidad)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
        // Un anticipo que no cubre el total es el primer abono.
        estado_pago:    encargoForm.pago_anticipado === 'SI' && !anticipoParcial ? 'PAGADO' : 'PENDIENTE',
        // Forma de pago solo si pagó anticipado.
        forma_pago:     encargoForm.pago_anticipado === 'SI' && !anticipoParcial ? (encargoForm.forma_pago || null) : null,
        ...(anticipoParcial && {
          abono_inicial: { monto: anticipoNum, forma_pago: encargoForm.forma_pago },
        }),
        // Sin fecha, la entrega es hoy.
        fecha_entrega:  fechaSegunDiaPrometido(encargoForm.tiempo_entrega, encargoForm.fecha_entrega),
        tiempo_entrega: encargoForm.tiempo_entrega || null,
        instrucciones:  encargoForm.instrucciones  || null,
      };
      const creada = await api.post('/notas', payload);
      setNotaCreada(creada);
    } catch (err) {
      // Alguien cerró la caja mientras se llenaba la nota.
      if (err.data?.code === 'CAJA_CERRADA') setCajaAbierta(false);
      setError(err.message);
    } finally {
      setEncargoLoading(false);
    }
  };

  // Lo que impide guardar la nota (o null). Lo usan Autoservicio y la venta de productos.
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

  // "Aceptar" de la venta de productos: valida y abre el cobro; la nota se crea
  // desde el modal.
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
    // Solo la venta de productos se cobra al crear; el Autoservicio nace pendiente.
    if (esVenta && !form.forma_pago) {
      setError('Elige la forma de pago.');
      return;
    }

    setLoading(true);

    // La venta de productos: sin cargas, máquinas ni cliente; nace pagada y finalizada.
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
      // Prenda de la nota (lista y etiqueta): la de la primera carga.
      tipo_prenda:     cargasAuto[0]?.tipo_prenda || 'ROPA',
      // Autoservicio nace En Espera, con sus máquinas asignadas sin arrancar.
      estado:          'EN_ESPERA',
      // Nace pendiente y se liquida desde el detalle.
      estado_pago:     'PENDIENTE',
      instrucciones:   form.instrucciones || null,
      // Nombre libre del cliente: la tarjeta de Notas lo enseña en vez de "Mostrador".
      referencia:      form.referencia.trim() || null,
      tipo_tela:       null,
      tamano_edredon:  null,
      // Cada renglón manda su máquina; el servidor la valida, la asigna sin arrancar y
      // la cobra. `*_tipo` solo en una carga vieja sin máquina.
      cargas:          cargasAuto.map(c => ({
        id:             c.id ?? null,
        lavadora_id:    c.lavadora?.id ?? null,
        secadora_id:    c.secadora?.id ?? null,
        lavadora_tipo:  c.lavadora ? null : (c.lavadora_tipo || null),
        secadora_tipo:  c.secadora ? null : (c.secadora_tipo || null),
        tipo_prenda:    esEdredonAuto(c) ? 'EDREDON' : 'ROPA',
      })),
      // Autoservicio no lleva ajuste.
      ajuste:          0,
      productos:       productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

    const payload = esVenta ? payloadVenta : payloadAutoservicio;

    try {
      const creada = await api.post('/notas', payload);
      setCobroOpen(false);
      setNotaCreada(creada);
    } catch (err) {
      // Alguien cerró la caja mientras se llenaba la nota.
      if (err.data?.code === 'CAJA_CERRADA') setCajaAbierta(false);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Buscador de cliente (solo Por Encargo, donde el cliente vuelve por su ropa).
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
            <p className="text-sm font-medium text-blue uppercase tracking-wide">Cliente seleccionado</p>
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
            <p className="text-sm font-medium text-blue uppercase tracking-wide">Cliente seleccionado</p>
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

      {/* Mostrador va arriba de crear cliente: es la salida rápida para quien no se registra. */}
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

  // Lista de productos de la nota (Autoservicio, venta de productos y lo que se
  // compra aparte en Por Encargo). Arriba, el granel de los servicios con sus
  // medidas; el producto se elige en Salidas.
  const bloqueGranel = () => {
    const tipos = resumenGranel();
    if (tipos.length === 0) return null;
    // Un renglón por servicio y tipo, en el mismo orden de servicios.
    const servicios = tipos[0].filas.map((f, k) => ({
      idx: f.idx, etiqueta: f.etiqueta,
      renglones: tipos.map(t => ({ tipoId: t.tipoId, nombre: t.nombre, medidas: t.filas[k].medidas })),
    }));
    const noAlcanza = tipos.filter(t => t.total > t.quedan);
    const btn = 'w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
        {servicios.map((sv, i) => (
          <div key={sv.idx} className={`px-3 py-4 space-y-1.5 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
            {/* "Medidas": cuántas medidas de cada granel lleva el servicio. */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{sv.etiqueta}</p>
              <span className="w-[7rem] text-center text-sm font-medium text-gray-500 uppercase tracking-wide">
                Medidas
              </span>
            </div>
            {sv.renglones.map(r => (
              <div key={r.tipoId} className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-600">{r.nombre}</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" className={btn} disabled={r.medidas <= 0}
                    onClick={() => setMedidasGranel(sv.idx, r.tipoId, r.medidas - 1)}
                    aria-label={`Una medida menos de ${r.nombre.toLowerCase()} en ${sv.etiqueta}`}>−</button>
                  <span className="w-7 text-center text-sm font-semibold text-gray-900 tabular-nums">{r.medidas}</span>
                  <button type="button" className={btn}
                    onClick={() => setMedidasGranel(sv.idx, r.tipoId, r.medidas + 1)}
                    aria-label={`Una medida más de ${r.nombre.toLowerCase()} en ${sv.etiqueta}`}>+</button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {/* Lo que no alcanza se cuenta por tipo, sumando todos los servicios. */}
        {noAlcanza.length > 0 && (
          <div className="px-3 py-3 border-t border-gray-100 bg-amber-50 space-y-0.5">
            {noAlcanza.map(t => (
              <p key={t.tipoId} className="text-sm font-semibold text-amber-700">
                No alcanza el {t.nombre.toLowerCase()}: se necesitan {t.total} {t.total === 1 ? 'medida' : 'medidas'} y quedan {t.quedan}.
              </p>
            ))}
            <p className="text-sm text-amber-700">La nota se crea igual.</p>
          </div>
        )}
      </div>
    );
  };

  const bloqueProductos = () => (
    <div>
      <div className="flex items-baseline gap-2 min-w-0 mb-2">
        <h2 className={LABEL_CLS + ' mb-0'}>Productos</h2>
        {productosLista.length > 0 && (
          <span className="text-sm text-gray-500 truncate">
            {productosLista.length} {productosLista.length === 1 ? 'producto' : 'productos'}
          </span>
        )}
      </div>

      {/* Campo que abre el modal de elegir producto, arriba de la lista. */}
      <button
        type="button"
        onClick={() => setSelectorProducto({ ambito: ambitoProductosNota })}
        className="w-full px-4 py-3.5 mb-3 border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between gap-2 hover:border-gray-400 transition-colors"
      >
        {/* En azul: se lee como acción. */}
        <span className="text-blue truncate">
          {productosLista.length === 0 ? 'Elige un producto' : 'Agregar otro producto'}
        </span>
        <svg className="w-5 h-5 flex-shrink-0 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {tipoServicio === 'POR_ENCARGO' && bloqueGranel()}



      {/* Fila compacta, como en Por Encargo; aquí se vende la pieza completa. Sin
          productos no se pinta la caja. */}
      {productosLista.length > 0 && (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {productosLista.map((item, i) => {
            const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
            const cant = Number(item.cantidad) || 0;
            // En Por Encargo el granel y las bolsas del servicio no se cobran: gastan del
            // precio del servicio, y el renglón lo dice. Las bolsas de más sí se cobran.
            const cobradas = prod ? cantidadCobrada(prod, cant) : cant;
            const subtotal = precioProductoNota(prod) * cobradas;
            const esMaterial = esMaterialDeNota(prod) && cobradas === 0;
            const incluidas = esMaterialDeNota(prod) && cobradas > 0 ? cant - cobradas : 0;
            return (
              <div key={i} className={`flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                {/* El producto no se cambia: se borra el renglón y se agrega otro. */}
                <div className="flex-1 min-w-[10rem]">
                  <p className={`text-sm font-semibold ${prod ? 'text-gray-900' : 'text-gray-400'}`}>
                    {prod ? etiquetaProducto(prod) : 'Producto no disponible'}
                  </p>
                  <p className="text-sm text-gray-500 tabular-nums">
                    {prod ? precioProductoTexto(prod, ambitoProductosNota) : '—'}
                    {prod && esMaterial && (
                      <span className="ml-1.5 not-italic text-gray-400">· va dentro del servicio</span>
                    )}
                    {prod && incluidas > 0 && (
                      <span className="ml-1.5 not-italic text-gray-400">
                        · {incluidas} {incluidas === 1 ? 'incluida' : 'incluidas'} en el servicio
                      </span>
                    )}
                  </p>
                  {!cabeOtraDe(prod) && (
                    <p className="text-sm text-amber-700">Ya no cabe otra en el servicio</p>
                  )}
                </div>

                {/* Cantidad, importe y borrar bajan juntos si no caben. */}
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
                      onClick={() => (cabeOtraDe(prod)
                        ? actualizarProducto(i, 'cantidad', String(cant + 1))
                        : setAvisoTope(prod))}
                      aria-label="Aumentar cantidad"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 transition-colors"
                    >
                      +
                    </button>
                    {/* Llegó al tope: el + sigue activo y explica por qué no sirve otra. */}
                    {!cabeOtraDe(prod) && (
                      <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Lo que va dentro del servicio dice "Incluido", como en Salidas. */}
                    {esMaterial ? (
                      <span className="w-16 text-right text-base font-bold text-green-700">Incluido</span>
                    ) : (
                      <span className="w-16 text-right text-base font-bold tabular-nums text-blue-700">
                        ${subtotal.toFixed(2)}
                      </span>
                    )}

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
          {/* En Por Encargo, sin nada que cobrar aparte no se muestra "$0.00". */}
          {(tipoServicio !== 'POR_ENCARGO' || subtotalProductos > 0) && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
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
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-movil md:max-w-2xl mx-auto">
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
            Nueva Nota
          </h1>
          <p className="text-sm text-gray-500">
            Crea una nueva nota
          </p>
        </div>
      </div>

      {/* Sin caja abierta no hay nota (el servidor también lo rechaza con 409). */}
      {cajaAbierta === false && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">La caja está cerrada</p>
          <p className="mt-0.5 text-sm text-amber-800">
            Ábrela para poder crear la nota.
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

      {/* Antes del modal de caja, para que "Abrir caja" quede encima. */}
      {anticipoOpen && (
        <ModalCobrar
          titulo="Pago anticipado"
          saldo={encargoPrecioTotal}
          total={encargoPrecioTotal}
          monto={anticipoMonto}
          onMonto={setAnticipoMonto}
          formaPago={anticipoForma}
          onFormaPago={setAnticipoForma}
          onCancelar={() => setAnticipoOpen(false)}
          onConfirmar={confirmarAnticipo}
          loading={false}
          error=""
          cajaAbierta={cajaAbierta}
          onAbrirCaja={() => setModalCajaOpen(true)}
        />
      )}

      {avisoTope && (
        <ConfirmacionModal
          tono="aviso"
          titulo={`Ya no cabe otra ${unidadDeTope(avisoTope)}`}
          mensaje={'Lo servido en la nota ya llega a lo que se cobra por los servicios. '
            + 'Para servir otra, quita algún producto o sube el precio del servicio en Ajustes.'}
          detalle={[
            { etiqueta: 'Se cobra por los servicios', valor: `$${presupuestoConAjuste.toFixed(2)}` },
            { etiqueta: 'Ya servido', valor: `$${materialUsado.toFixed(2)}` },
            { etiqueta: `Otra ${unidadDeTope(avisoTope)}`, valor: `$${precioProductoNota(avisoTope).toFixed(2)}` },
          ]}
          onClose={() => setAvisoTope(null)}
        />
      )}

      <AbrirCajaModal
        open={modalCajaOpen}
        onClose={() => setModalCajaOpen(false)}
        onAbierta={() => { setModalCajaOpen(false); setCajaAbierta(true); }} // el aviso desaparece
      />

      <form onSubmit={handleSubmit} className={`space-y-8 ${cajaAbierta === false ? 'hidden' : ''}`}>

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

            {/* Paso 2 — Servicios: cuántos de cada uno, su detalle, el material, el
                ajuste y los productos aparte. */}
            {encargoStep === PASO_SERVICIOS && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      Cantidad de servicios <span className="text-red-500">*</span>
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Cada servicio ya incluye lavado, secado, jabón y bolsa. Qué jabón y qué
                      suavizante se usan se elige en Salidas.
                    </p>
                  </div>

                  {/* Un renglón por servicio: precio a la izquierda, contador a la derecha. */}
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    {serviciosVisibles.map((s, i) => {
                      const cant   = cuentaServicio(s.v);
                      const precio = precioServicio(s.v);
                      return (
                        <div
                          key={s.v}
                          className={`flex items-center gap-3 px-4 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                        >
                          {/* El importe junto al precio (una tercera columna no cabe en el teléfono). */}
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-gray-900 truncate">
                              {s.titulo ?? s.label}
                              {s.legado && (
                                <span className="ml-2 text-sm font-normal text-gray-400">ya no se vende</span>
                              )}
                            </p>
                            <p className={`text-sm tabular-nums ${precio == null ? 'text-red-600' : 'text-gray-500'}`}>
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
                        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
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
                      <p className="text-sm text-red-600 mt-0.5">
                        Se configura en Ajustes → Servicios Por Encargo.
                      </p>
                    </div>
                  )}
                </div>

                {/* Oculto (MOSTRAR_DETALLE_SERVICIO): tela y tamaño de edredón son opcionales. */}
                {MOSTRAR_DETALLE_SERVICIO && (<>
                {/* Detalle de cada servicio (opcional): tela de la ropa y tamaño del edredón. */}
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
                          // Para numerarlo ("Chico 1", "Chico 2"); con uno solo no se numera.
                          const mismos = encargoCargas.filter(x => x.servicio === c.servicio);
                          const num    = mismos.indexOf(c) + 1;
                          const etiqueta = mismos.length > 1 ? `${nombre} ${num}` : nombre;
                          return (
                            <div key={idx} className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 space-y-2.5">
                              <p className="text-sm font-semibold text-gray-900">{etiqueta}</p>
                              {/* El tamaño del edredón ya es su servicio. */}
                              {c.tipo_prenda === 'EDREDON' ? null : (
                                <Selector
                                  claseCampo={INPUT_CLS}
                                  valor={c.tipo_tela}
                                  onChange={v => actualizarCargaEncargo(idx, { tipo_tela: v })}
                                  titulo={`Tipo de tela · ${etiqueta}`}
                                  opciones={[
                                    { valor: '', etiqueta: 'Tipo de tela sin asignar' },
                                    ...telas.filter(t => t.activo || t.nombre === c.tipo_tela)
                                      .map(t => ({ valor: t.nombre, etiqueta: t.nombre })),
                                  ]}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                </>)}

                {/* Productos: una sola lista. Cada renglón dice si va dentro del servicio
                    (granel y bolsas) o si se cobra aparte (marca y polvo). */}
                <Separador />
                {bloqueProductos()}

                {/* Un servicio cuyo material cuesta más de lo que se cobra. */}
                {encargoCargas.map((c, idx) => {
                  const exceso = excesoDeCarga(c);
                  if (!(exceso > 0)) return null;
                  const nombre = SERVICIO_POR_V[c.servicio]?.label ?? `Carga ${idx + 1}`;
                  return (
                    <div key={idx} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <p className="text-sm font-semibold text-red-700">
                        El servicio {nombre} se cobra en ${Number(topeDeCarga(c)).toFixed(2)} y su material suma ${usadoContraTope(c).toFixed(2)}
                      </p>
                      <p className="text-sm text-red-600 mt-0.5">
                        Baja ${exceso.toFixed(2)}: sirve menos, quita la bolsa o sube el precio del servicio en Ajustes.
                      </p>
                    </div>
                  );
                })}

                {/* Ajuste de la nota, junto al tope y al total que mueve. */}
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
                  <p className="text-sm text-gray-400 mt-1.5">Descuento (negativo) o cargo extra (positivo)</p>
                </div>

                {/* El tope a la vista: cuánto se cobra, cuánto lleva el material y cuánto queda. */}
                {presupuestoServicios > 0 && (
                  excesoDeLaNota > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                      <p className="text-sm font-semibold text-red-700">
                        El material suma ${materialUsado.toFixed(2)} y el tope
                        {ajusteEncargo !== 0 ? ', ya con el ajuste,' : ''} es ${presupuestoConAjuste.toFixed(2)}
                      </p>
                      <p className="text-sm text-red-600 mt-0.5">
                        Baja ${excesoDeLaNota.toFixed(2)}: quita productos, sirve menos
                        {ajusteEncargo < 0 ? ', baja el descuento' : ''} o sube el precio de los servicios en Ajustes.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-right tabular-nums">
                      {nCargas === 1 ? 'Tope del servicio' : 'Tope de los servicios'}: ${presupuestoServicios.toFixed(2)}
                      {' · '}usado ${materialUsado.toFixed(2)}
                      {/* El ajuste se nombra aparte cuando lo hay. */}
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
                          // Al salir de "Otra" se limpia la fecha.
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

                {/* El calendario solo aparece con "Otra". */}
                {encargoForm.tiempo_entrega === 'OTRA' && (
                  <div>
                    <label className={LABEL_CLS}>Fecha de entrega</label>
                    <div className="relative">
                      <input
                        type="date" name="fecha_entrega"
                        value={encargoForm.fecha_entrega} onChange={handleEncargoChange}
                        // Sin el ícono nativo; showPicker abre el selector al tocar cualquier parte.
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
                <p className="text-sm font-medium text-blue uppercase tracking-wide mb-2">Resumen</p>
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
                      <span className="font-medium">{formaPagoLabel(encargoForm.forma_pago)}</span>
                    </div>
                  )}
                  {anticipoParcial && (
                    <div className="flex justify-between">
                      <span>Abono</span>
                      <span className="font-medium">${anticipoNum.toFixed(2)}</span>
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
                {/* Un renglón por servicio y debajo lo que va encima: productos y ajuste. El
                    material incluido no se lista: va en el precio del servicio. */}
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
                    return prod && cantidadCobrada(prod, Number(p.cantidad) || 0) > 0;
                  }) && (
                    <div className="pt-2 mt-1 border-t border-blue-200/60 space-y-2">
                      {productosLista.map((p, j) => {
                        const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
                        // El material va dentro del precio del servicio: no es un renglón
                        // (de las bolsas, solo las de más).
                        const cant = prod ? cantidadCobrada(prod, Number(p.cantidad) || 0) : 0;
                        if (!prod || cant <= 0) return null;
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

            {/* Pago anticipado, debajo del resumen: se cobra viendo lo que se cobra. */}
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
                        onClick={() => {
                          // "Sí" abre el modal de Cobrar.
                          if (opt.v === 'SI') { abrirAnticipo(); return; }
                          setEncargoForm(f => ({
                            ...f, pago_anticipado: opt.v,
                            forma_pago: opt.v === 'SI' ? f.forma_pago : '',
                            monto_anticipo: opt.v === 'SI' ? f.monto_anticipo : '',
                          }));
                        }}
                        className={`py-8 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                          selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Lo cobrado: cuánto, cómo y si queda debiendo. Tocarlo reabre el cobro. */}
                {encargoForm.pago_anticipado === 'SI' && (
                  <button
                    type="button"
                    onClick={abrirAnticipo}
                    className="w-full text-left rounded-xl border border-blue-200 bg-light-blue px-4 py-3 hover:border-blue-300 transition-colors"
                  >
                    <span className="flex items-center justify-between gap-3 text-sm text-blue-700">
                      <span>
                        {anticipoParcial ? 'Abono' : 'Cobrado'} · {formaPagoLabel(encargoForm.forma_pago)}
                      </span>
                      <span className="font-semibold">
                        ${(anticipoParcial ? anticipoNum : encargoPrecioTotal).toFixed(2)}
                      </span>
                    </span>
                    {anticipoParcial && (
                      <span className="block text-sm text-blue-700 mt-0.5">
                        Queda debiendo ${(encargoPrecioTotal - anticipoNum).toFixed(2)}
                      </span>
                    )}
                    <span className="block text-sm text-blue underline underline-offset-2 mt-1">Cambiar</span>
                  </button>
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
                    ? 'Creando...'
                    : 'Crear nota'}
                </button>
              )}
            </div>
          </div>
        )}

        {tipoServicio === 'AUTOSERVICIO' && (
        <div className="space-y-8">
        {/* 32 px entre secciones; contenedor propio para no depender del space-y del form. */}
        <div className="space-y-8">

          {/* ── Cliente / referencia (opcional) ──────────────
              Texto libre: de quién es la ropa en la tarjeta de Notas. */}
          <div>
            <label htmlFor="referencia" className={LABEL_CLS}>Cliente / referencia</label>
            <input
              id="referencia"
              type="text"
              maxLength={80}
              value={form.referencia}
              onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))}
              placeholder="Nombre o seña del cliente (opcional)"
              className={INPUT_CLS}
            />
          </div>

          {/* ── Máquinas ─────────────────────────────────────
              Se eligen de las libres, en el mismo modal que Salidas; cada una entra con
              su tarifa, así el resumen dice lo que se cobra. */}
          <div>
            <div className="flex items-baseline gap-2 min-w-0 mb-2">
              <h2 className={LABEL_CLS + ' mb-0'}>Máquinas <span className="text-red-500">*</span></h2>
              {cargasAuto.length > 0 && (
                <span className="text-sm text-gray-500 truncate">
                  {cargasAuto.length} {cargasAuto.length === 1 ? 'máquina' : 'máquinas'}
                </span>
              )}
            </div>

            {/* Se ve como un campo más; abre el modal de máquinas libres. */}
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
              {/* En azul: se lee como acción. */}
              <span className="text-blue truncate">
                {cargasAuto.length === 0 ? 'Elige lavadora o secadora' : 'Agregar otra máquina'}
              </span>
              {/* Un + porque abre un modal donde se marcan varias. */}
              <svg className="w-5 h-5 flex-shrink-0 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Fila compacta: qué es, qué cobra y quitarla. Sin máquinas no se pinta la caja. */}
            {cargasAuto.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {cargasAuto.map((c, i) => (
                  <div key={i} className={`flex items-center gap-x-2 px-3 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{etiquetaRenglon(c) || `Máquina ${i + 1}`}</p>
                    </div>
                    <span className={`text-right tabular-nums ${secadoraPorDefinir(c)
                      ? 'text-sm font-semibold text-amber-700' : 'w-16 text-base font-bold text-blue-700'}`}>
                      {montoRenglon(c)}
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
                <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  Total máquinas
                </span>
                <span className="text-base font-bold text-dark-blue tabular-nums">
                  ${subtotalCargas.toFixed(2)}
                </span>
              </div>
            </div>
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

              {/* Cada máquina con lo que cobra. */}
              {cargasAuto.length > 0 && (
                <div className="space-y-1.5 mb-3 last:mb-0 text-sm text-blue border-t border-blue-200 pt-3">
                  {cargasAuto.map((c, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="font-medium truncate">{tipoDeRenglon(c) || '—'}</span>
                      <span className="flex-shrink-0 font-medium tabular-nums">
                        {montoRenglon(c)}
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
                  <div className="pl-3 mt-1.5 space-y-1.5 text-sm text-blue-700/80">
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
                          {/* "· Granel" distingue el bidón del producto de marca que se llama igual. */}
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

              {/* Total. No hay forma de pago: la nota nace pendiente y se liquida en su detalle.
                  Con la secadora por definir (la Sec49) no hay total que enseñar todavía:
                  su renglón ya dice "Por definir". */}
              {!hayPorDefinir() && (
                <div className="flex items-baseline justify-between border-t border-blue-200 pt-3">
                  <span className="text-sm font-medium text-blue">Total</span>
                  <span className="text-3xl font-bold text-blue-700 tabular-nums">${precioTotal.toFixed(2)}</span>
                </div>
              )}
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
          {/* Sin cobro aquí: la nota nace pendiente y se liquida desde su detalle. */}
          <button
            type="button" onClick={() => handleSubmit()} disabled={loading}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading
              ? 'Creando...'
              : 'Aceptar'}
          </button>
        </div>
        </div>
        )}
        {/* ── Venta de Productos ──────────────────────────────
            Sin cliente, cargas ni máquinas: al aceptar se cobra y queda finalizada. */}
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
                  <div className="pl-3 mt-1.5 space-y-1.5 text-sm text-blue-700/80">
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
                            {/* "· Granel" distingue el bidón del producto de marca que se llama igual. */}
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
        ofrecerEdredon
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
                <p className="text-sm text-gray-500 mt-0.5">Se cobra al momento</p>
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

              <div className="grid grid-cols-2 gap-3">
                {FORMAS_PAGO_COBRO.map(opt => {
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
                  ? 'Creando...'
                  : 'Crear nota'}
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
                <p className="text-sm text-gray-500 mt-0.5">
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
                // Todo el catálogo en cualquier servicio; lo que cambia es la unidad.
                const lista = productosCatalogo;
                if (lista.length === 0) {
                  return (
                    <p className="px-2 py-6 text-center text-sm text-gray-500">
                      No hay productos dados de alta.
                    </p>
                  );
                }
                // Los ya puestos no se ofrecen: para llevar más se sube la cantidad.
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
                            <p className="text-sm text-gray-500 tabular-nums">{detalleProducto(p, ambito)}</p>
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
                <label className={LABEL_CLS}>
                  Teléfono <span className="text-red-500">*</span>
                </label>
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
                  disabled={creandoCliente || !nuevoCliente.nombre.trim() || !nuevoCliente.telefono.trim()}
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-8 text-center space-y-5 animate-shake">
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-8 text-center space-y-5 animate-pop-in">
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
