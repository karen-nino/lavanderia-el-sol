import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { etiquetaProducto } from '../lib/formatoInventario';
import { capitalizarNombre } from '../lib/texto';
import { FORMAS_PAGO } from '../lib/formasPago';

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
];
const TIPO_LABEL = Object.fromEntries(TIPOS_SERVICIO.map(t => [t.v, t.label]));

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

// Autoservicio: cada carga es UNA sola máquina. Primero se elige el tipo
// (lavadora o secadora) y luego la máquina de ese tipo.
const TIPOS_MAQUINA = [
  { v: 'lavadora', label: 'Lavadora' },
  { v: 'secadora', label: 'Secadora' },
];
// Autoservicio: la carga elige el TIPO de lavado y/o secado (no la máquina
// física, que se asigna después en Salidas), igual que Por Encargo.
const CARGA_INIT  = { lavadora_tipo: '', secadora_tipo: '', tipo_prenda: 'ROPA', tipo_tela: '', tamano_edredon: '' };
const MAX_CARGAS  = 20;

const TAMANOS = [
  { v: 'chico',  label: 'Chico'  },
  { v: 'grande', label: 'Grande' },
  { v: 'jumbo',  label: 'Jumbo'  },
];
const TAMANO_LABEL = Object.fromEntries(TAMANOS.map(t => [t.v, t.label]));

// Datos a nivel nota. Prenda, tamaño, máquinas, ajuste y productos ahora
// viven en cada carga (encargoCargas).
const ENCARGO_INIT = {
  cliente_id:      '',
  pago_anticipado: '',
  forma_pago:      '',
  fecha_entrega:   '',
  tiempo_entrega:  '',
  instrucciones:   '',
};

// Una carga de Por Encargo: su prenda, tela/tamaño edredón, tamaño de carga,
// máquinas (+activar), ajuste y sus productos.
const CARGA_ENCARGO_INIT = {
  tipo_prenda:            '',
  tipo_tela:              '',
  tamano_edredon:         '',
  tamano:                 '',
  // En Por Encargo se elige el TIPO de máquina (no una máquina física): la
  // máquina real se asigna después en Salidas. '' = sin lavado / sin secado.
  lavadora_tipo:          '',
  secadora_tipo:          '',
  ajuste:                 '0',
  productos:              [],
  sin_bolsa:              false,   // la bolsa se agrega sola por el tamaño; se puede quitar
  empaquetado:            true,    // el empaquetado se incluye por defecto; se puede quitar
};

const TIEMPOS_ENTREGA = [
  { v: 'MANANA', label: 'Mañana' },
  { v: 'TARDE',  label: 'Tarde'  },
  { v: 'NOCHE',  label: 'Noche'  },
];
const TIEMPO_ENTREGA_LABEL = Object.fromEntries(TIEMPOS_ENTREGA.map(t => [t.v, t.label]));

// Fecha de hoy en formato YYYY-MM-DD (local). Se usa como entrega por defecto
// cuando no se elige una fecha en el paso de Entrega.
const fechaHoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Pasos fijos del wizard, además de una pantalla por carga:
// Cliente, Cantidad de cargas, [Carga ×N], Pago, Entrega, Instrucciones, Resumen.
const ENCARGO_STEPS_FIJOS = 5;

const formatMaquina = (m) => {
  if (!m) return '';
  // El tamaño solo aplica a lavadoras; la secadora es de un solo tamaño.
  if (m.tipo === 'lavadora_mediana') return `${m.nombre} — Mediana`;
  if (m.tipo === 'lavadora_jumbo')   return `${m.nombre} — Jumbo`;
  return m.nombre;
};

export default function NuevaNota() {
  const navigate = useNavigate();
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const [maquinas,          setMaquinas]          = useState([]);
  // IDs de las máquinas que ya trae esta nota (en edición): nunca se muestran
  // como "Reservada", porque están apartadas por la propia nota.
  const [maquinasNotaIds,   setMaquinasNotaIds]   = useState(() => new Set());
  const [productosCatalogo, setProductosCatalogo] = useState([]);
  const [telas,             setTelas]             = useState([]);
  const [tamanosEdredon,    setTamanosEdredon]    = useState([]);
  const [precios,           setPrecios]           = useState({ mediana: 70, jumbo: 70, secadora: 45, secadoraJumbo: 45, secadoraEdredon: 45, edredonJumbo: 80 });
  // Tope de precio por carga (Ajustes); null = sin tope. `edredon` es un tope
  // por prenda que manda sobre el del tamaño para las cargas de edredón.
  const [topes,             setTopes]             = useState({ chico: null, grande: null, jumbo: null, edredon: null });
  const [costoEmpaquetado,  setCostoEmpaquetado]  = useState(0);
  const [loadingData,       setLoadingData]       = useState(true);
  const [form,              setForm]              = useState(FORM_INIT);
  const [productosLista,    setProductosLista]    = useState([]);
  const [error,             setError]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [tipoServicio,      setTipoServicio]      = useState('');
  const [tipoOpen,          setTipoOpen]          = useState(false);
  const [cargasAuto,        setCargasAuto]        = useState([{ ...CARGA_INIT }]);
  const [encargoStep,       setEncargoStep]       = useState(1);
  const [encargoForm,       setEncargoForm]       = useState(ENCARGO_INIT);
  const [encargoCargas,     setEncargoCargas]     = useState([{ ...CARGA_ENCARGO_INIT }]);
  const [encargoLoading,    setEncargoLoading]    = useState(false);
  const [clientes,          setClientes]          = useState([]);
  const [clienteSearch,     setClienteSearch]     = useState('');
  const [nuevoClienteOpen,  setNuevoClienteOpen]  = useState(false);
  // Selector para agregar un producto. `ambito` distingue los productos de la
  // nota (Autoservicio, por botella) de los de una carga (Por Encargo, por
  // tapa); `carga` solo aplica al segundo. Un producto puesto no se cambia: se
  // borra y se agrega el correcto.
  const [selectorProducto,  setSelectorProducto]  = useState(null);
  // Autoservicio se cobra al momento: "Aceptar" abre este modal, donde se elige
  // la forma de pago y se confirma la creación de la nota.
  const [cobroOpen,         setCobroOpen]         = useState(false);
  const [nuevoCliente,      setNuevoCliente]      = useState({ nombre: '', apellido: '', telefono: '' });
  const [creandoCliente,    setCreandoCliente]    = useState(false);
  const [folio,             setFolio]             = useState('');
  const [notaCreada,        setNotaCreada]        = useState(null);
  const tipoRef           = useRef(null);

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

  const precioPorTipo = (tipoMaquina, tipoPrendaArg) => {
    if (tipoMaquina === 'secadora') return precios.secadora;
    if (tipoMaquina === 'lavadora_jumbo' && tipoPrendaArg === 'EDREDON') return precios.edredonJumbo;
    if (tipoMaquina === 'lavadora_jumbo') return precios.jumbo;
    return precios.mediana;
  };
  // La secadora es de un solo tamaño: precio único (ignora tamaño y prenda).
  const precioSecado = () => precios.secadora;
  const tamanoDe = (maquinaId) => maquinas.find(m => String(m.id) === String(maquinaId))?.tamano;
  // Precio por TIPO de máquina en Por Encargo (mediana/jumbo), independiente de
  // qué máquina física se asigne luego.
  const precioLavadoTipo = (tipo, prenda) =>
    tipo === 'jumbo'   ? precioPorTipo('lavadora_jumbo', prenda)
    : tipo === 'mediana' ? precioPorTipo('lavadora_mediana', prenda)
    : 0;
  const precioSecadoTipo = (tipo, prenda) => (tipo ? precioSecado(tipo, prenda) : 0);
  // ¿La máquina está apartada por OTRA nota abierta? (las de esta nota no cuentan)
  const esReservada = (m) => Boolean(m?.reservada) && !maquinasNotaIds.has(String(m.id));
  // Sufijo " — Reservada (folio)" para las opciones del selector; vacío si no.
  const sufijoReservada = (m) =>
    esReservada(m) ? ` — Reservada${m.reservada_folio ? ` (${m.reservada_folio})` : ''}` : '';
  // Cada carga se cobra con la tarifa del TIPO de lavado más la del secado.
  const subtotalDeCarga = (c) =>
    precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda) + precioSecadoTipo(c.secadora_tipo, c.tipo_prenda);
  const ajusteNum      = Number(form.ajuste) || 0;
  // Precio efectivo de un producto según la unidad de venta: en Autoservicio se
  // vende por BOTELLA (precio_botella); en Por Encargo por TAPA (precio_unitario).
  const precioProducto = (prod, unidad = 'tapa') => {
    if (!prod) return 0;
    if (prod.clase === 'bolsa') return Number(prod.precio_unitario) || 0; // por pieza
    return unidad === 'botella'
      ? (Number(prod.precio_botella) || 0)
      : (Number(prod.precio_unitario) || 0);
  };
  // Botellas disponibles de un producto (el stock viene en tapas).
  const botellasDisponibles = (prod) => {
    if (!prod) return 0;
    const tpb = Number(prod.tapas_por_botella) || 0;
    const disp = Number(prod.stock_disponible ?? prod.stock_actual) || 0;
    return tpb > 0 ? Math.floor(disp / tpb) : disp;
  };
  // Palabra de la unidad vendida en Autoservicio: botella (granel), unidad
  // (marca) o bolsa (bolsa, por pieza).
  const unidadVentaNota = (prod, n = 2) => {
    if (prod?.clase === 'bolsa') return n === 1 ? 'bolsa' : 'bolsas';
    if (prod?.tipo_liquido === 'marca') return n === 1 ? 'unidad' : 'unidades';
    return n === 1 ? 'botella' : 'botellas';
  };
  // Producto por defecto de una carga Por Encargo: el jabón (granel). Se usa el
  // que se llame "jabón"; si no, el primer granel disponible.
  const conStock = (p) => Number(p.stock_disponible ?? p.stock_actual) > 0;
  const jabonDefault = productosCatalogo.find(p => p.tipo_liquido === 'granel' && conStock(p) && /jab[oó]n/i.test(p.nombre || ''))
    ?? productosCatalogo.find(p => p.tipo_liquido === 'granel' && conStock(p));
  const defaultProductosCarga = () => (jabonDefault ? [{ producto_id: String(jabonDefault.id), cantidad: '1' }] : []);
  const subtotalCargas = cargasAuto.reduce((s, c) => s + subtotalDeCarga(c), 0);
  // Autoservicio: los productos a nivel nota se cobran por botella.
  const subtotalProductos = productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    return sum + precioProducto(prod, 'botella') * (Number(p.cantidad) || 0);
  }, 0);
  const precioTotal = subtotalCargas + ajusteNum + subtotalProductos;

  useEffect(() => {
    const promesas = [
      api.get('/maquinas'),
      api.get('/productos'),
      api.get('/ajustes'),
      api.get('/clientes'),
      api.get('/etiquetas/tipos-tela'),
      api.get('/etiquetas/tamanos-edredon'),
    ];
    promesas.push(esEdicion ? api.get(`/notas/${id}`) : api.get('/notas/next-folio'));

    Promise.all(promesas)
      .then((resultados) => {
        const [m, prod, cfg, cli, telasCat, tamanosCat, extra] = resultados;
        setTelas(telasCat || []);
        setTamanosEdredon(tamanosCat || []);
        const nota = esEdicion ? extra : null;
        setFolio(esEdicion ? (nota?.folio ?? '') : (extra?.folio ?? ''));
        // En edición, incluir las máquinas de la nota aunque no estén "disponibles"
        const idsActuales = esEdicion
          ? (nota?.cargas ?? []).flatMap(c => [c.lavadora_id, c.secadora_id]).filter(Boolean)
          : [];
        // Se incluyen también las máquinas "reservada" (libres pero apartadas
        // por otra nota abierta): no se ocultan, se muestran deshabilitadas como
        // Reservada. Las de la propia nota (idsActuales) siempre quedan elegibles.
        const maquinasFiltradas = m.filter(
          maq => maq.estado === 'disponible' || idsActuales.includes(maq.id)
        );
        setMaquinas(maquinasFiltradas);
        setMaquinasNotaIds(new Set(idsActuales.map(String)));
        setProductosCatalogo(prod);
        if (cfg) {
          setPrecios({
            mediana:         cfg.precio_carga_mediana    != null ? Number(cfg.precio_carga_mediana)    : 70,
            jumbo:           cfg.precio_carga_jumbo      != null ? Number(cfg.precio_carga_jumbo)      : 70,
            // Secado por categoría; el precio plano (precio_carga_secadora) es Mediana.
            secadora:        cfg.precio_carga_secadora   != null ? Number(cfg.precio_carga_secadora)   : 45,
            secadoraJumbo:   cfg.precio_secadora_jumbo   != null ? Number(cfg.precio_secadora_jumbo)   : 45,
            secadoraEdredon: cfg.precio_secadora_edredon != null ? Number(cfg.precio_secadora_edredon) : 45,
            edredonJumbo:    cfg.precio_edredon_jumbo    != null ? Number(cfg.precio_edredon_jumbo)    : 80,
          });
          setTopes({
            chico:   cfg.tope_carga_chico   != null ? Number(cfg.tope_carga_chico)   : null,
            grande:  cfg.tope_carga_grande  != null ? Number(cfg.tope_carga_grande)  : null,
            jumbo:   cfg.tope_carga_jumbo   != null ? Number(cfg.tope_carga_jumbo)   : null,
            edredon: cfg.tope_carga_edredon != null ? Number(cfg.tope_carga_edredon) : null,
          });
          setCostoEmpaquetado(cfg.costo_empaquetado != null ? Number(cfg.costo_empaquetado) : 0);
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
            setEncargoForm({
              cliente_id:      nota.cliente_id ? String(nota.cliente_id) : '',
              pago_anticipado: nota.estado_pago === 'PAGADO' ? 'SI' : 'NO',
              forma_pago:      nota.forma_pago ?? '',
              fecha_entrega:   nota.fecha_entrega  ? String(nota.fecha_entrega).slice(0, 10) : '',
              tiempo_entrega:  nota.tiempo_entrega ?? '',
              instrucciones:   nota.instrucciones  ?? '',
            });
            // Cargas de la nota; si es una nota vieja sin cargas, se arma una
            // carga a partir de los campos legados a nivel nota.
            const cargasNota = (nota.cargas ?? []).map(c => ({
              tipo_prenda:            c.tipo_prenda ?? prendaNota,
              tipo_tela:              c.tipo_tela      ?? '',
              tamano_edredon:         c.tamano_edredon ?? '',
              tamano:                 c.tamano         ?? '',
              lavadora_tipo:          c.lavadora_tipo ?? '',
              secadora_tipo:          c.secadora_tipo ?? '',
              ajuste:                 c.ajuste != null ? String(c.ajuste) : '0',
              // La bolsa se maneja aparte (auto por tamaño): se saca de la lista
              // de productos y se recuerda si estaba puesta o no.
              productos:              (c.productos ?? [])
                .filter(p => p.clase !== 'bolsa')
                .map(p => ({ producto_id: String(p.producto_id), cantidad: String(p.cantidad) })),
              sin_bolsa:              !(c.productos ?? []).some(p => p.clase === 'bolsa'),
              empaquetado:            Number(c.empaquetado) > 0,
            }));
            setEncargoCargas(cargasNota.length > 0 ? cargasNota : [{
              ...CARGA_ENCARGO_INIT,
              tipo_prenda:    prendaNota,
              tipo_tela:      nota.tipo_tela      ?? '',
              tamano_edredon: nota.tamano_edredon ?? '',
              tamano:         nota.tamano         ?? '',
              ajuste:         nota.ajuste != null ? String(nota.ajuste) : '0',
              productos:      prods,
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
            // Cada carga lleva su TIPO de lavado y/o secado (la máquina se asigna
            // en Salidas).
            const cargasNota = (nota.cargas ?? []).map(c => ({
              tipo_prenda:    (c.tipo_prenda ?? prendaNota) || 'ROPA',
              tipo_tela:      c.tipo_tela      ?? '',
              tamano_edredon: c.tamano_edredon ?? '',
              lavadora_tipo:  c.lavadora_tipo_previsto ?? '',
              secadora_tipo:  c.secadora_tipo_previsto ?? '',
            }));
            setCargasAuto(cargasNota.length > 0 ? cargasNota : [{ ...CARGA_INIT }]);
            setProductosLista(prods);
          }
        }
      })
      .finally(() => setLoadingData(false));
  }, [id, esEdicion]);

  // Al crear (no editar), la carga trae por defecto el jabón (1 tapa) en cuanto
  // el catálogo cargó. Se hace una sola vez: si el empleado lo quita, no vuelve.
  const jabonSeededRef = useRef(false);
  useEffect(() => {
    if (esEdicion || jabonSeededRef.current || !jabonDefault) return;
    jabonSeededRef.current = true;
    setEncargoCargas(prev => prev.map(c => (c.productos?.length ? c : { ...c, productos: defaultProductosCarga() })));
  }, [jabonDefault, esEdicion]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const agregarProducto = (productoId = '') =>
    setProductosLista(prev => [...prev, { producto_id: String(productoId), cantidad: '1' }]);

  const actualizarProducto = (i, field, value) =>
    setProductosLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarProducto = (i) =>
    setProductosLista(prev => prev.filter((_, idx) => idx !== i));

  // Ajusta el número de cargas conservando las selecciones existentes.
  const setCantidadCargas = (n) => {
    const objetivo = Math.max(1, Math.min(MAX_CARGAS, n));
    setCargasAuto(prev => {
      if (objetivo === prev.length) return prev;
      if (objetivo < prev.length)  return prev.slice(0, objetivo);
      return [...prev, ...Array.from({ length: objetivo - prev.length }, () => ({ ...CARGA_INIT }))];
    });
  };

  const actualizarCarga = (i, campo, valor) =>
    setCargasAuto(prev => prev.map((c, idx) => (idx === i ? { ...c, [campo]: valor } : c)));

  // Actualiza una carga de Autoservicio con un objeto de cambios parcial.
  const actualizarCargaObj = (i, cambios) =>
    setCargasAuto(prev => prev.map((c, idx) => (idx === i ? { ...c, ...cambios } : c)));

  const handleEncargoChange = (e) => {
    const { name, value } = e.target;
    setEncargoForm(f => ({ ...f, [name]: value }));
  };

  // ── Cargas de Por Encargo ───────────────────────────────
  const setEncargoCantidadCargas = (n) => {
    const objetivo = Math.max(1, Math.min(MAX_CARGAS, n));
    setEncargoCargas(prev => {
      if (objetivo === prev.length) return prev;
      if (objetivo < prev.length)  return prev.slice(0, objetivo);
      return [...prev, ...Array.from({ length: objetivo - prev.length }, () => ({ ...CARGA_ENCARGO_INIT, productos: defaultProductosCarga() }))];
    });
  };

  const actualizarCargaEncargo = (i, cambios) =>
    setEncargoCargas(prev => prev.map((c, idx) => (idx === i ? { ...c, ...cambios } : c)));

  // Productos por carga
  const agregarProductoCarga = (i, productoId = '') =>
    actualizarCargaEncargo(i, { productos: [...(encargoCargas[i].productos ?? []), { producto_id: String(productoId), cantidad: '1' }] });

  const actualizarProductoCarga = (i, j, field, value) =>
    setEncargoCargas(prev => prev.map((c, idx) =>
      idx === i
        ? { ...c, productos: c.productos.map((p, k) => (k === j ? { ...p, [field]: value } : p)) }
        : c
    ));

  // Diferencias entre los dos ámbitos, en un solo lugar: Por Encargo cobra por
  // tapa y solo admite granel; Autoservicio cobra por botella (o pieza) y admite
  // todo el catálogo.
  const esCarga        = (ambito) => ambito === 'carga';
  const catalogoDe     = (ambito) => (esCarga(ambito)
    ? productosCatalogo.filter(p => p.tipo_liquido === 'granel')
    : productosCatalogo);
  const precioEnAmbito = (prod, ambito) => precioProducto(prod, esCarga(ambito) ? 'tapa' : 'botella');
  const unidadEnAmbito = (prod, ambito, n = 2) => (esCarga(ambito)
    ? (n === 1 ? 'tapa' : 'tapas')
    : unidadVentaNota(prod, n));
  // Cuántas piezas se pueden vender: en tapas para Por Encargo, en botellas
  // (o unidades sueltas) para Autoservicio.
  const disponiblesDe  = (prod, ambito) => {
    if (!prod) return 0;
    return esCarga(ambito)
      ? Number(prod.stock_disponible ?? prod.stock_actual) || 0
      : botellasDisponibles(prod);
  };
  // Orden de presentación de los productos: primero el granel, luego los de
  // marca y al final las bolsas (igual que ordena el catálogo el backend).
  const ordenProducto = (p) =>
    p?.tipo_liquido === 'granel' ? 0 : p?.tipo_liquido === 'marca' ? 1 : 2;

  // Precio con su unidad: "$5.00/tapa".
  const precioProductoTexto = (prod, ambito) =>
    `$${precioEnAmbito(prod, ambito).toFixed(2)}/${unidadEnAmbito(prod, ambito, 1)}`;
  // Lo anterior más las existencias: "$5.00/tapa · 140 tapas". Solo en el
  // selector, que es donde sirven para decidir.
  const detalleProducto = (prod, ambito) => {
    const disp = disponiblesDe(prod, ambito);
    return `${precioProductoTexto(prod, ambito)} · ${disp} ${unidadEnAmbito(prod, ambito, disp)}`;
  };

  // Agrega a la nota o a la carga el producto elegido en el modal.
  const elegirProducto = (productoId) => {
    if (!selectorProducto) return;
    const { ambito, carga } = selectorProducto;
    if (esCarga(ambito)) agregarProductoCarga(carga, productoId);
    else                 agregarProducto(productoId);
    setSelectorProducto(null);
  };

  const eliminarProductoCarga = (i, j) =>
    setEncargoCargas(prev => prev.map((c, idx) =>
      idx === i ? { ...c, productos: c.productos.filter((_, k) => k !== j) } : c
    ));

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

  // Pasos dinámicos: Cliente, Cantidad, [una pantalla por carga], Pago,
  // Entrega (fecha + tiempo + instrucciones), Resumen.
  const nCargas          = encargoCargas.length;
  const ENCARGO_STEPS    = nCargas + ENCARGO_STEPS_FIJOS;
  const esPasoCarga      = encargoStep >= 3 && encargoStep <= 2 + nCargas;
  const cargaActivaIdx   = esPasoCarga ? encargoStep - 3 : -1;
  const pasoPago         = 3 + nCargas;
  const pasoEntrega      = 4 + nCargas; // fecha + tiempo + instrucciones
  const pasoResumen      = 5 + nCargas;

  const subtotalProductosLista = (lista) => (lista ?? []).reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    return sum + precioProducto(prod) * (Number(p.cantidad) || 0);
  }, 0);

  // ── Bolsas (Por Encargo): según el tamaño de la carga se incluye 1 bolsa ──
  const bolsasCatalogo = productosCatalogo.filter(p => p.clase === 'bolsa');
  // Mapa carga → tamaño de bolsa: chico→chica, grande→grande, jumbo→jumbo, edredón→jumbo.
  const bolsaTamanoParaCarga = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') return 'jumbo';
    if (c?.tamano === 'chico')  return 'chica';
    if (c?.tamano === 'grande') return 'grande';
    if (c?.tamano === 'jumbo')  return 'jumbo';
    return null;
  };
  const bolsaDeCarga = (c) => {
    const t = bolsaTamanoParaCarga(c);
    return t ? (bolsasCatalogo.find(b => b.tamano_bolsa === t) ?? null) : null;
  };
  // Existencia disponible de una bolsa (piezas). Sin existencia no se incluye
  // (para no bloquear la nota) y se avisa en la carga.
  const bolsaTieneStock = (b) => b && Number(b.stock_disponible ?? b.stock_actual) > 0;
  // La bolsa aplica si hay una para el tamaño, con existencia y no se quitó.
  const bolsaAplicada = (c) => {
    if (c.sin_bolsa) return null;
    const b = bolsaDeCarga(c);
    return bolsaTieneStock(b) ? b : null;
  };
  const costoBolsaCarga = (c) => Number(bolsaAplicada(c)?.precio_unitario) || 0;
  // Empaquetado (Ajustes): incluido por defecto salvo que se quite en la carga.
  const empaquetadoAplica = (c) => costoEmpaquetado > 0 && c.empaquetado !== false;
  const costoEmpaquetadoCarga = (c) => (empaquetadoAplica(c) ? costoEmpaquetado : 0);

  // Tope de la carga (Ajustes). Prenda edredón usa su tope dedicado (manda
  // sobre el del tamaño). NULL = sin tope configurado.
  const topeDeCarga  = (c) => {
    if (String(c?.tipo_prenda).toUpperCase() === 'EDREDON') return topes.edredon ?? null;
    return c?.tamano ? (topes[c.tamano] ?? null) : null;
  };

  // Costo interno de la carga: lavado + secado (por tipo) + productos. Es lo
  // que se compara contra el tope (el ajuste manual va aparte y NO cuenta).
  const usadoContraTope = (c) =>
    precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda)
    + precioSecadoTipo(c.secadora_tipo, c.tipo_prenda)
    + subtotalProductosLista(c.productos)
    + costoBolsaCarga(c)
    + costoEmpaquetadoCarga(c);

  // Precio cobrado por una carga de encargo. Con tope configurado el precio ES
  // el tope (precio fijo de la carga, aunque el costo interno sea menor); sin
  // tope, es la suma real. En ambos casos se suma el ajuste manual (va aparte).
  const subtotalCargaEncargo = (c) => {
    const tope = topeDeCarga(c);
    const base = tope != null ? Number(tope) : usadoContraTope(c);
    return base + (Number(c.ajuste) || 0);
  };
  const encargoPrecioTotal  = encargoCargas.reduce((s, c) => s + subtotalCargaEncargo(c), 0);
  // Subtotal real de la nota: suma del costo real (máquinas + productos) de
  // todas las cargas. Informativo para el empleado; el cliente paga el total.
  const encargoSubtotalReal = encargoCargas.reduce((s, c) => s + usadoContraTope(c), 0);

  const excesoDeCarga = (c) => {
    const tope = topeDeCarga(c);
    return tope != null ? usadoContraTope(c) - tope : 0;
  };
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

  const encargoPuedeAvanzar = (() => {
    if (encargoStep === 1) return !!encargoForm.cliente_id;
    if (encargoStep === 2) return nCargas >= 1;
    if (esPasoCarga) {
      const c = encargoCargas[cargaActivaIdx];
      if (!c || !c.tipo_prenda || !c.tamano) return false;
      // La carga necesita al menos un tipo de lavado o secado.
      if (!c.lavadora_tipo && !c.secadora_tipo) return false;
      // Tope de precio: no se puede avanzar con la carga pasada de presupuesto.
      if (excesoDeCarga(c) > 0) return false;
      return true;
    }
    if (encargoStep === pasoPago) {
      if (!encargoForm.pago_anticipado) return false;
      // Si pagó anticipado, hay que elegir la forma de pago.
      if (encargoForm.pago_anticipado === 'SI' && !encargoForm.forma_pago) return false;
      return true;
    }
    return true;
  })();

  const handleEncargoSubmit = async () => {
    setError('');
    // Tope de precio por carga: el backend también lo rechaza, pero aquí se
    // avisa antes de mandar (p. ej. si se regresó a editar una carga previa).
    const idxExcedida = encargoCargas.findIndex(c => excesoDeCarga(c) > 0);
    if (idxExcedida >= 0) {
      const c = encargoCargas[idxExcedida];
      const exceso = usadoContraTope(c) - Number(topeDeCarga(c));
      setError(`La carga ${idxExcedida + 1} rebasa el tope de $${topeDeCarga(c).toFixed(2)} `
        + `(máquinas + productos, bolsa y empaquetado suman $${usadoContraTope(c).toFixed(2)}). `
        + `Baja $${exceso.toFixed(2)}: quita algún producto, la bolsa o el empaquetado.`);
      return;
    }
    setEncargoLoading(true);
    try {
      const cargasPayload = encargoCargas.map(c => ({
        tipo_prenda:    c.tipo_prenda || 'ROPA',
        tipo_tela:      c.tipo_prenda === 'ROPA'    ? (c.tipo_tela || null) : null,
        tamano_edredon: c.tipo_prenda === 'EDREDON' ? (c.tamano_edredon || null) : null,
        tamano:         c.tamano || null,
        // Por Encargo: solo el TIPO de máquina (la física se asigna en Salidas).
        lavadora_tipo:  c.lavadora_tipo || null,
        secadora_tipo:  c.secadora_tipo || null,
        activar:        false,
        ajuste:         Number(c.ajuste) || 0,
        empaquetado:    c.empaquetado !== false,
        productos:      [
          ...(c.productos ?? [])
            .filter(p => p.producto_id && p.cantidad)
            .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
          // La bolsa del tamaño de la carga (si aplica y no se quitó): 1 pieza.
          ...(bolsaAplicada(c) ? [{ producto_id: Number(bolsaAplicada(c).id), cantidad: 1 }] : []),
        ],
      }));
      const payload = {
        tipo_servicio:      'POR_ENCARGO',
        // Prenda a nivel nota (para lista/badge): la de la primera carga.
        tipo_prenda:    encargoCargas[0]?.tipo_prenda || 'ROPA',
        cliente_id:     Number(encargoForm.cliente_id),
        cargas:         cargasPayload,
        ajuste:         0, // el ajuste va por carga
        estado_pago:    encargoForm.pago_anticipado === 'SI' ? 'PAGADO' : 'PENDIENTE',
        // Forma de pago solo si pagó anticipado; si queda a deber, va null.
        forma_pago:     encargoForm.pago_anticipado === 'SI' ? (encargoForm.forma_pago || null) : null,
        // Si no se eligió fecha, la entrega se da por hecho para hoy.
        fecha_entrega:  encargoForm.fecha_entrega  || fechaHoyISO(),
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

  // Lo que hay que tener listo antes de pasar al cobro. Devuelve el problema o
  // null si todo está en orden.
  const problemaAutoservicio = () => {
    if (!cargasAuto.every(c => c.lavadora_tipo || c.secadora_tipo)) {
      return 'Cada carga necesita al menos un tipo de lavado o secado.';
    }
    return null;
  };

  // "Aceptar": valida la nota y abre el cobro. La nota se crea desde el modal.
  const abrirCobro = () => {
    const problema = problemaAutoservicio();
    setError(problema ?? '');
    if (!problema) setCobroOpen(true);
  };

  // Se llama desde el modal (sin evento) y como submit del formulario.
  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (tipoServicio !== 'AUTOSERVICIO') return;
    setError('');

    const problema = problemaAutoservicio();
    if (problema) {
      setError(problema);
      setCobroOpen(false);
      return;
    }
    // Autoservicio se cobra al momento: hay que elegir la forma de pago.
    if (!form.forma_pago) {
      setError('Elige la forma de pago.');
      return;
    }

    setLoading(true);

    const payload = {
      tipo_servicio:       'AUTOSERVICIO',
      // La prenda/tela ahora viven en cada carga; a nivel nota se guarda la de
      // la primera carga solo para la lista/badge.
      tipo_prenda:     cargasAuto[0]?.tipo_prenda || 'ROPA',
      // Autoservicio nace En Espera SIN máquina: se elige el tipo y la máquina
      // física se asigna después en Salidas (igual que Por Encargo).
      estado:          'EN_ESPERA',
      estado_pago:     'PAGADO',
      forma_pago:      form.forma_pago || null,
      // null (no undefined) para que al editar, limpiar un campo lo borre.
      instrucciones:   form.instrucciones || null,
      tipo_tela:       null,
      tamano_edredon:  null,
      // La carga elige el TIPO de lavado/secado; la máquina se asigna en Salidas.
      cargas:          cargasAuto.map(c => ({
        lavadora_tipo:  c.lavadora_tipo || null,
        secadora_tipo:  c.secadora_tipo || null,
        tipo_prenda:    c.tipo_prenda || 'ROPA',
        tipo_tela:      (c.tipo_prenda || 'ROPA') === 'ROPA' ? (c.tipo_tela || null) : null,
        tamano_edredon: c.tipo_prenda === 'EDREDON' ? (c.tamano_edredon || null) : null,
      })),
      ajuste:          ajusteNum,
      productos:       productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

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
            {encargoStep === 1 && (
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
            )}

            {/* Paso 2 — Cantidad de cargas */}
            {encargoStep === 2 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Cantidad de cargas</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="1" max={MAX_CARGAS} step="1"
                    value={nCargas}
                    onChange={e => setEncargoCantidadCargas(Number(e.target.value) || 1)}
                    className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  />
                  <button
                    type="button"
                    onClick={() => setEncargoCantidadCargas(nCargas - 1)}
                    disabled={nCargas <= 1}
                    aria-label="Disminuir cargas"
                    className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setEncargoCantidadCargas(nCargas + 1)}
                    disabled={nCargas >= MAX_CARGAS}
                    aria-label="Aumentar cargas"
                    className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>
                <p className="text-xs text-gray-400">Configurarás cada carga en las siguientes pantallas.</p>
              </div>
            )}

            {/* Una pantalla por carga */}
            {esPasoCarga && (() => {
              const idx = cargaActivaIdx;
              const c = encargoCargas[idx];
              const set = (cambios) => actualizarCargaEncargo(idx, cambios);
              // 32 px entre las secciones de la carga: algo más de aire que el
              // resto del wizard, porque aquí caben varias en una pantalla.
              return (
                <div className="space-y-8">
                  <h2 className="text-base font-semibold text-gray-900">Carga {idx + 1} de {nCargas}</h2>

                  {/* Tamaño de carga */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-900">Tamaño de carga <span className="text-red-500">*</span></h3>
                    <div className="grid grid-cols-3 gap-3">
                      {TAMANOS.map(t => {
                        const selected = c.tamano === t.v;
                        return (
                          <button
                            key={t.v}
                            type="button"
                            onClick={() => {
                              const cambios = { tamano: t.v };
                              if (t.v !== 'jumbo') {
                                // Chico/Grande son siempre Ropa: se fija la prenda
                                // y se ocultan las opciones de edredón.
                                cambios.tipo_prenda = 'ROPA';
                                cambios.tamano_edredon = '';
                                // Chico/Grande no usan lavadora jumbo: si venía elegida, se limpia.
                                if (c.lavadora_tipo === 'jumbo') cambios.lavadora_tipo = '';
                              } else {
                                // Jumbo: el edredón es el caso principal, queda por
                                // defecto. Una lavadora no-jumbo ya no sirve.
                                cambios.tipo_prenda = 'EDREDON';
                                cambios.tipo_tela = '';
                                // El edredón solo va en lavado Jumbo.
                                if (c.lavadora_tipo && c.lavadora_tipo !== 'jumbo') cambios.lavadora_tipo = '';
                              }
                              set(cambios);
                            }}
                            className={`py-6 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                              selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tipo de prenda — solo en Jumbo (Chico/Grande se dan por Ropa) */}
                  {c.tamano === 'jumbo' && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-900">Tipo de prenda</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {/* En Jumbo el edredón es el caso principal: va primero. */}
                      {[...TIPOS_PRENDA].sort((a, b) => (a.v === 'EDREDON' ? -1 : b.v === 'EDREDON' ? 1 : 0)).map(opt => {
                        const selected = c.tipo_prenda === opt.v;
                        return (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => {
                              const cambios = { tipo_prenda: opt.v };
                              if (opt.v !== 'ROPA') cambios.tipo_tela = '';
                              if (opt.v !== 'EDREDON') cambios.tamano_edredon = '';
                              if (opt.v === 'EDREDON') {
                                // El edredón solo va en lavado Jumbo.
                                if (c.lavadora_tipo && c.lavadora_tipo !== 'jumbo') cambios.lavadora_tipo = '';
                              }
                              set(cambios);
                            }}
                            className={`py-6 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                              selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {/* Tipo de tela (ropa) */}
                  {c.tipo_prenda === 'ROPA' && (
                    <div>
                      <label className={LABEL_CLS}>
                        Tipo de tela <span className="font-normal text-gray-400">(opcional)</span>
                      </label>
                      <select
                        value={c.tipo_tela}
                        onChange={e => set({ tipo_tela: e.target.value })}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="">Sin asignar</option>
                        {telas.filter(t => t.activo || t.nombre === c.tipo_tela).map(t => (
                          <option key={t.id} value={t.nombre}>{t.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Tamaño del edredón */}
                  {c.tipo_prenda === 'EDREDON' && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Tamaño del edredón <span className="font-normal text-gray-400">(opcional)</span>
                      </h3>
                      {tamanosEdredon.filter(t => t.activo || t.nombre === c.tamano_edredon).length === 0 ? (
                        <p className="text-sm text-gray-400">No hay tamaños de edredón configurados.</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          {tamanosEdredon.filter(t => t.activo || t.nombre === c.tamano_edredon).map(opt => {
                            const selected = c.tamano_edredon === opt.nombre;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => set({ tamano_edredon: selected ? '' : opt.nombre })}
                                className={`py-6 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                                  selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                                }`}
                              >
                                {opt.nombre}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tipo de máquina — se elige el TIPO (no la máquina física, que
                      se asigna después en Salidas). Aparece tras elegir prenda y
                      tamaño de carga. */}
                  {c.tamano && c.tipo_prenda && (
                  <>
                  <Separador />
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-900">Tipo de máquina</h3>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Lavado</label>
                      <select
                        value={c.lavadora_tipo}
                        onChange={e => {
                          const v = e.target.value;
                          // Al elegir un lavado se marca también el secado (el empleado lo quita si no lo quieren).
                          set(v ? { lavadora_tipo: v, secadora_tipo: 'mediana' } : { lavadora_tipo: v });
                        }}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="">Sin lavado</option>
                        {/* Edredón va en jumbo; para ropa, la jumbo solo en carga jumbo (chico/grande solo mediana). */}
                        {c.tipo_prenda === 'EDREDON' ? (
                          <option value="jumbo">Jumbo — ${precioLavadoTipo('jumbo', c.tipo_prenda).toFixed(2)}</option>
                        ) : (
                          <>
                            <option value="mediana">Mediana — ${precioLavadoTipo('mediana', c.tipo_prenda).toFixed(2)}</option>
                            {c.tamano === 'jumbo' && (
                              <option value="jumbo">Jumbo — ${precioLavadoTipo('jumbo', c.tipo_prenda).toFixed(2)}</option>
                            )}
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Secado</label>
                      <select
                        value={c.secadora_tipo}
                        onChange={e => set({ secadora_tipo: e.target.value })}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="">Sin secado</option>
                        <option value="mediana">Con secado — ${precioSecadoTipo('mediana', c.tipo_prenda).toFixed(2)}</option>
                      </select>
                    </div>
                    {!c.lavadora_tipo && !c.secadora_tipo && (
                      <p className="text-sm text-red-600">
                        Elige al menos un tipo de lavado o secado para continuar.
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      La máquina física se asigna después en Salidas de la nota.
                    </p>
                  </div>
                  </>
                  )}

                  {c.tamano && c.tipo_prenda && (
                  <>
                  <Separador />
                  {/* Productos de la carga */}
                  <div>
                    {/* Agregar vive solo en el encabezado: así no cambia de sitio
                        conforme crece la lista. */}
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">Productos</h3>
                        {(c.productos ?? []).length > 0 && (
                          <span className="text-xs text-gray-500 truncate">{c.productos.length} {c.productos.length === 1 ? 'producto' : 'productos'}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectorProducto({ ambito: 'carga', carga: idx })}
                        className="flex-shrink-0 flex items-center gap-1.5 bg-blue text-white rounded-pill pl-3 pr-4 py-2.5 text-xs font-bold hover:opacity-90 transition-opacity"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        Agregar producto
                      </button>
                    </div>

                    {/* Una fila por producto. */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      {(c.productos ?? []).length === 0 ? (
                        <p className="px-4 py-5 text-sm text-gray-500">No hay productos en esta carga.</p>
                      ) : (
                        c.productos.map((item, j) => {
                          const prod  = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
                          const cant  = Number(item.cantidad) || 0;
                          const subtotal = precioProducto(prod) * cant;
                          return (
                            <div key={j} className={`flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4 ${j > 0 ? 'border-t border-gray-100' : ''}`}>
                              {/* Solo texto: el producto no se cambia, se borra el renglón y se
                                  agrega el correcto. */}
                              <div className="flex-1 min-w-[10rem]">
                                <p className={`text-sm font-semibold ${prod ? 'text-gray-900' : 'text-gray-400'}`}>
                                  {prod ? etiquetaProducto(prod) : 'Producto no disponible'}
                                </p>
                                <p className="text-xs text-gray-500 tabular-nums">
                                  {prod ? precioProductoTexto(prod, 'carga') : '—'}
                                </p>
                              </div>

                              {/* Cantidad, importe y borrar viajan juntos: si no
                                  caben junto al nombre, bajan al siguiente renglón. */}
                              <div className="flex flex-1 items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => actualizarProductoCarga(idx, j, 'cantidad', String(Math.max(1, cant - 1)))}
                                    disabled={cant <= 1}
                                    aria-label="Disminuir cantidad"
                                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    −
                                  </button>
                                  <span className="w-7 text-center text-sm font-semibold text-gray-900 tabular-nums">{cant}</span>
                                  <button
                                    type="button"
                                    onClick={() => actualizarProductoCarga(idx, j, 'cantidad', String(cant + 1))}
                                    aria-label="Aumentar cantidad"
                                    className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-base font-semibold hover:bg-gray-50 transition-colors"
                                  >
                                    +
                                  </button>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="w-16 text-right text-base font-bold text-blue-700 tabular-nums">
                                    ${subtotal.toFixed(2)}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => eliminarProductoCarga(idx, j)}
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
                        })
                      )}

                      {(c.productos ?? []).length > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total productos</span>
                          <span className="text-base font-bold text-dark-blue tabular-nums">
                            ${subtotalProductosLista(c.productos).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bolsa incluida según el tamaño de la carga (editable) */}
                  {bolsaDeCarga(c) && (
                    <div className="rounded-xl border border-gray-200 p-4 bg-amber-50/40">
                      {!bolsaTieneStock(bolsaDeCarga(c)) ? (
                        <p className="text-sm text-gray-500">
                          No hay bolsas {bolsaDeCarga(c).tamano_bolsa} en existencia — no se incluye ninguna.
                        </p>
                      ) : !c.sin_bolsa ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              Bolsa {bolsaDeCarga(c).tamano_bolsa}
                              <span className="text-xs text-green-700 font-medium"> · Incluida</span>
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Se cobra ${(Number(bolsaDeCarga(c).precio_unitario) || 0).toFixed(2)} en la nota
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => actualizarCargaEncargo(idx, { sin_bolsa: true })}
                            className="flex-shrink-0 text-xs text-gray-400 hover:text-red-600 underline"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => actualizarCargaEncargo(idx, { sin_bolsa: false })}
                          className="text-sm text-blue hover:text-blue-800 font-medium"
                        >
                          + Agregar bolsa {bolsaDeCarga(c).tamano_bolsa}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Empaquetado (Ajustes), incluido por defecto y editable */}
                  {costoEmpaquetado > 0 && (
                    <div className="rounded-xl border border-gray-200 p-4 bg-amber-50/40">
                      {c.empaquetado !== false ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              Empaquetado
                              <span className="text-xs text-green-700 font-medium"> · Incluido</span>
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Se cobra ${costoEmpaquetado.toFixed(2)} en la nota
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => actualizarCargaEncargo(idx, { empaquetado: false })}
                            className="flex-shrink-0 text-xs text-gray-400 hover:text-red-600 underline"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => actualizarCargaEncargo(idx, { empaquetado: true })}
                          className="text-sm text-blue hover:text-blue-800 font-medium"
                        >
                          + Agregar empaquetado
                        </button>
                      )}
                    </div>
                  )}

                  {/* El ajuste es su propia sección: la línea lo separa de lo
                      que se cobra por la carga (productos, bolsa, empaquetado). */}
                  <Separador />

                  {/* Ajuste de la carga */}
                  <div>
                    <label className={LABEL_CLS}>Ajuste ($)</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                        <input
                          type="number" step="any"
                          value={c.ajuste}
                          onChange={e => set({ ajuste: e.target.value })}
                          placeholder="Ej. -10 para descuento, 20 para cargo extra"
                          className={`${INPUT_CLS} pl-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => set({ ajuste: String((Number(c.ajuste) || 0) - 10) })}
                        aria-label="Disminuir ajuste"
                        className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => set({ ajuste: String((Number(c.ajuste) || 0) + 10) })}
                        aria-label="Aumentar ajuste"
                        className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  </>
                  )}

                  {c.tamano && c.tipo_prenda && (() => {
                    const tope   = topeDeCarga(c);
                    const usado  = usadoContraTope(c);
                    const exceso = tope != null ? usado - tope : 0;
                    return (
                      <div className="space-y-2">
                        {tope != null && (exceso > 0 ? (
                          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                            <p className="text-sm font-semibold text-red-700">
                              La carga rebasa el tope de ${tope.toFixed(2)} por ${exceso.toFixed(2)}
                            </p>
                            <p className="text-xs text-red-600 mt-0.5">
                              Máquinas y productos suman ${usado.toFixed(2)}. Quita productos para
                              poder continuar (el ajuste no cuenta contra el tope).
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 text-right">
                            Tope de la carga: ${tope.toFixed(2)} · usado ${usado.toFixed(2)} · disponible ${(tope - usado).toFixed(2)}
                          </p>
                        ))}
                        <p className="text-sm font-medium text-blue text-right">
                          Subtotal carga: ${subtotalCargaEncargo(c).toFixed(2)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Pago Anticipado */}
            {encargoStep === pasoPago && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Pago Anticipado</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[{ v: 'SI', label: 'Sí' }, { v: 'NO', label: 'No' }].map(opt => {
                    const selected = encargoForm.pago_anticipado === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setEncargoForm(f => ({ ...f, pago_anticipado: opt.v, forma_pago: opt.v === 'SI' ? f.forma_pago : '' }))}
                        className={`py-8 px-2 border-2 rounded-xl font-semibold text-lg truncate transition-colors ${
                          selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

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
                            onClick={() => setEncargoForm(f => ({ ...f, forma_pago: opt.v }))}
                            className={`py-6 px-2 border-2 rounded-xl font-semibold text-base truncate transition-colors ${
                              selected ? 'border-blue bg-light-blue text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                            }`}
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

            {/* Entrega: fecha + tiempo + instrucciones */}
            {encargoStep === pasoEntrega && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-900">Entrega</h2>
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
                <div>
                  <label className={LABEL_CLS}>Tiempo de entrega</label>
                  <div className="grid grid-cols-3 gap-3">
                    {TIEMPOS_ENTREGA.map(t => {
                      const selected = encargoForm.tiempo_entrega === t.v;
                      return (
                        <button
                          key={t.v}
                          type="button"
                          onClick={() => setEncargoForm(f => ({ ...f, tiempo_entrega: f.tiempo_entrega === t.v ? '' : t.v }))}
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
                        : '—'}
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
                  {encargoForm.fecha_entrega && (
                    <div className="flex justify-between"><span>Entrega</span><span className="font-medium">{encargoForm.fecha_entrega}</span></div>
                  )}
                  {encargoForm.tiempo_entrega && (
                    <div className="flex justify-between"><span>Tiempo</span><span className="font-medium">{TIEMPO_ENTREGA_LABEL[encargoForm.tiempo_entrega]}</span></div>
                  )}
                </div>
                <div className="space-y-5 mb-2 text-sm text-blue border-t border-blue-200 pt-4">
                  {encargoCargas.map((c, i) => {
                    const tipoLabel = t => t === 'jumbo' ? 'Jumbo' : t === 'mediana' ? 'Mediana' : t === 'edredon' ? 'Edredón' : '';
                    const partes = [
                      c.lavadora_tipo && `Lavadora ${tipoLabel(c.lavadora_tipo)}`,
                      c.secadora_tipo && `Secadora`,
                    ].filter(Boolean);
                    const detalle = [PRENDA_LABEL[c.tipo_prenda], c.tamano ? TAMANO_LABEL[c.tamano] : null].filter(Boolean).join(', ');
                    const productosCarga = (c.productos ?? []).filter(p => p.producto_id && Number(p.cantidad) > 0);
                    const lavPrecio = precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda);
                    const secPrecio = precioSecadoTipo(c.secadora_tipo, c.tipo_prenda);
                    const ajuste = Number(c.ajuste) || 0;
                    return (
                      <div key={i} className="pb-4 border-b border-blue-200/60 last:border-0 last:pb-0">
                        <p className="font-medium">
                          Carga {i + 1}{detalle ? ` — ${detalle}` : ''}{partes.length > 0 ? ` (${partes.join(' + ')})` : ''}
                        </p>
                        {/* Costo real: desglose de máquinas y productos */}
                        <p className="mt-2.5 text-xs font-semibold text-blue-700/70 uppercase tracking-wide">Costo real</p>
                        <ul className="mt-1.5 ml-3 space-y-2 text-xs text-blue-700/80">
                          {c.lavadora_tipo && (
                            <li className="flex justify-between gap-2"><span>· Lavado {tipoLabel(c.lavadora_tipo)}</span><span>${lavPrecio.toFixed(2)}</span></li>
                          )}
                          {c.secadora_tipo && (
                            <li className="flex justify-between gap-2"><span>· Secado</span><span>${secPrecio.toFixed(2)}</span></li>
                          )}
                          {productosCarga.map((p, j) => {
                            const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
                            if (!prod) return null;
                            const cant = Number(p.cantidad) || 0;
                            const unidad = prod.es_por_tapa ? (cant === 1 ? 'tapa' : 'tapas') : (prod.unidad || 'u');
                            return (
                              <li key={j} className="flex justify-between gap-2">
                                <span>· {prod.nombre}{prod.marca ? ` ${prod.marca}` : ''} × {cant} {unidad}</span>
                                <span>${(precioProducto(prod) * cant).toFixed(2)}</span>
                              </li>
                            );
                          })}
                          {bolsaAplicada(c) && (
                            <li className="flex justify-between gap-2">
                              <span>· Bolsa {bolsaAplicada(c).tamano_bolsa} × 1</span>
                              <span>${(Number(bolsaAplicada(c).precio_unitario) || 0).toFixed(2)}</span>
                            </li>
                          )}
                          {empaquetadoAplica(c) && (
                            <li className="flex justify-between gap-2">
                              <span>· Empaquetado</span>
                              <span>${costoEmpaquetado.toFixed(2)}</span>
                            </li>
                          )}
                        </ul>
                        {/* Subtotal (costo real), ajuste y total de la carga */}
                        <div className="mt-3 space-y-2">
                          <div className="flex justify-between gap-2"><span>Subtotal</span><span>${usadoContraTope(c).toFixed(2)}</span></div>
                          {ajuste !== 0 && (
                            <div className="flex justify-between gap-2">
                              <span>Ajuste</span>
                              <span>{ajuste < 0 ? '−' : '+'}${Math.abs(ajuste).toFixed(2)}</span>
                            </div>
                          )}
                          <div className="flex justify-between gap-2 font-semibold">
                            <span>Total carga</span><span>${subtotalCargaEncargo(c).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Subtotal de la nota (costo real, informativo) y total a pagar */}
                <div className="flex justify-between text-sm text-blue border-t border-blue-200 pt-4">
                  <span>Subtotal (costo real)</span>
                  <span>${encargoSubtotalReal.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between pt-3">
                  <span className="text-sm font-medium text-blue">Total de la nota</span>
                  <span className="text-3xl font-bold text-blue-700">${encargoPrecioTotal.toFixed(2)}</span>
                </div>
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
                  disabled={encargoLoading}
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

          {/* Cuántas cargas y las cargas en sí son lo mismo: se agrupan
              para que el aire de sección no las separe. */}
          <div className="space-y-3">
            {/* Cantidad de cargas */}
            <div className="pb-6">
              <label className={LABEL_CLS}>
                Cantidad de cargas <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max={MAX_CARGAS} step="1"
                  value={cargasAuto.length}
                  onChange={e => setCantidadCargas(Number(e.target.value) || 1)}
                  className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                />
                <button
                  type="button"
                  onClick={() => setCantidadCargas(cargasAuto.length - 1)}
                  disabled={cargasAuto.length <= 1}
                  aria-label="Disminuir cargas"
                  className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setCantidadCargas(cargasAuto.length + 1)}
                  disabled={cargasAuto.length >= MAX_CARGAS}
                  aria-label="Aumentar cargas"
                  className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Cada carga usa una máquina: lavadora o secadora</p>
            </div>

            {/* Máquinas por carga */}
            <div className="space-y-3">
              {cargasAuto.map((c, i) => {
                const set = (cambios) => actualizarCargaObj(i, cambios);
                return (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900">Carga {i + 1}</p>
                      <span className="text-sm font-medium text-blue">${subtotalDeCarga(c).toFixed(2)}</span>
                    </div>
                    {/* Autoservicio: se elige el TIPO de lavado y/o secado; la
                        máquina física se asigna después en Salidas. */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Lavado</label>
                      <select
                        value={c.lavadora_tipo}
                        onChange={e => {
                          const v = e.target.value;
                          // Al elegir un lavado se marca también el secado (el empleado lo quita si no lo quieren).
                          set(v ? { lavadora_tipo: v, secadora_tipo: 'mediana' } : { lavadora_tipo: v });
                        }}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="">Sin lavado</option>
                        <option value="mediana">Mediana — ${precioLavadoTipo('mediana', c.tipo_prenda).toFixed(2)}</option>
                        <option value="jumbo">Jumbo — ${precioLavadoTipo('jumbo', c.tipo_prenda).toFixed(2)}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Secado</label>
                      <select
                        value={c.secadora_tipo}
                        onChange={e => set({ secadora_tipo: e.target.value })}
                        className={`${INPUT_CLS} bg-white`}
                      >
                        <option value="">Sin secado</option>
                        <option value="mediana">Con secado — ${precioSecadoTipo('mediana', c.tipo_prenda).toFixed(2)}</option>
                      </select>
                    </div>
                    {!c.lavadora_tipo && !c.secadora_tipo && (
                      <p className="text-sm text-red-600">Elige al menos un tipo de lavado o secado.</p>
                    )}
                    <p className="text-xs text-gray-400">La máquina física se asigna después en Salidas de la nota.</p>
                  </div>
                );
              })}
              <p className="text-xs text-blue font-medium">
                Subtotal cargas: ${subtotalCargas.toFixed(2)}
              </p>
              {maquinas.length === 0 && (
                <p className="text-xs text-red-600">No hay máquinas disponibles en este momento.</p>
              )}
            </div>
          </div>

          <Separador />

          {/* ── Productos ────────────────────────────────────── */}

          <div>
            {/* Agregar vive solo en el encabezado: así no cambia de sitio conforme
                crece la lista. */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <h2 className={LABEL_CLS + ' mb-0'}>Productos</h2>
                {productosLista.length > 0 && (
                  <span className="text-xs text-gray-500 truncate">
                    {productosLista.length} {productosLista.length === 1 ? 'producto' : 'productos'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectorProducto({ ambito: 'nota' })}
                className="flex-shrink-0 flex items-center gap-1.5 bg-blue text-white rounded-pill pl-3 pr-4 py-2.5 text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Agregar producto
              </button>
            </div>

            {/* Misma fila compacta que en Por Encargo. La diferencia es la unidad:
                aquí se vende la pieza completa (botella, unidad o bolsa). */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {productosLista.length === 0 ? (
                <p className="px-4 py-5 text-sm text-gray-500">No hay productos en esta nota.</p>
              ) : (
                productosLista.map((item, i) => {
                  const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
                  const cant = Number(item.cantidad) || 0;
                  const subtotal = precioProducto(prod, 'botella') * cant;
                  return (
                    <div key={i} className={`flex flex-wrap items-center gap-x-2 gap-y-4 px-3 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                      {/* Solo texto: el producto no se cambia, se borra el renglón y se
                          agrega el correcto. */}
                      <div className="flex-1 min-w-[10rem]">
                        <p className={`text-sm font-semibold ${prod ? 'text-gray-900' : 'text-gray-400'}`}>
                          {prod ? etiquetaProducto(prod) : 'Producto no disponible'}
                        </p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {prod ? precioProductoTexto(prod, 'nota') : '—'}
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
                          <span className="w-16 text-right text-base font-bold text-blue-700 tabular-nums">
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
                })
              )}

              {productosLista.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total productos</span>
                  <span className="text-base font-bold text-dark-blue tabular-nums">
                    ${subtotalProductos.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separador />

          {/* Ajuste */}
          <div>
            <label className={LABEL_CLS}>Ajuste ($)</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" name="ajuste" step="any"
                  value={form.ajuste} onChange={handleChange}
                  placeholder="Ej. -10 para descuento, 20 para cargo extra"
                  className={`${INPUT_CLS} pl-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                />
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, ajuste: String((Number(f.ajuste) || 0) - 10) }))}
                aria-label="Disminuir ajuste"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, ajuste: String((Number(f.ajuste) || 0) + 10) }))}
                aria-label="Aumentar ajuste"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                +
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Descuento (negativo) o cargo extra (positivo)</p>
          </div>

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
                  <span>Cargas</span>
                  <span className="font-medium">{cargasAuto.length}</span>
                </div>
              </div>

              {/* Cada carga con lo que se le cobra. La máquina física no va
                  aquí: en Autoservicio se elige el tipo y se asigna en Salidas. */}
              <div className="space-y-3 mb-3 text-sm text-blue border-t border-blue-200 pt-3">
                {cargasAuto.map((c, i) => {
                  const lavado = precioLavadoTipo(c.lavadora_tipo, c.tipo_prenda);
                  const secado = precioSecadoTipo(c.secadora_tipo, c.tipo_prenda);
                  return (
                    <div key={i}>
                      <div className="flex justify-between font-medium">
                        <span>Carga {i + 1}</span>
                        <span>${subtotalDeCarga(c).toFixed(2)}</span>
                      </div>
                      <div className="pl-3 mt-1.5 space-y-1.5 text-xs text-blue-700/80">
                        {c.lavadora_tipo ? (
                          <div className="flex justify-between">
                            <span>Lavado · {c.lavadora_tipo.charAt(0).toUpperCase() + c.lavadora_tipo.slice(1)}</span>
                            <span>${lavado.toFixed(2)}</span>
                          </div>
                        ) : (
                          <div>Sin lavado</div>
                        )}
                        {c.secadora_tipo ? (
                          <div className="flex justify-between">
                            <span>Secado</span>
                            <span>${secado.toFixed(2)}</span>
                          </div>
                        ) : (
                          <div>Sin secado</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {productosLista.length > 0 && (
                <div className="space-y-2 mb-3 text-sm text-blue border-t border-blue-200 pt-3">
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
                            {etiquetaProducto(prod)}{prod.tipo_liquido === 'granel' ? ' · Granel' : ''}
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
              {/* Mismo remate que el resumen de Por Encargo. */}
              <div className="flex items-baseline justify-between border-t border-blue-200 pt-3">
                <span className="text-sm font-medium text-blue">Total</span>
                <span className="text-3xl font-bold text-blue-700">${precioTotal.toFixed(2)}</span>
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

      {/* Modal — cobro de Autoservicio: forma de pago y confirmación */}
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
                <span className="text-2xl font-bold text-blue-700 tabular-nums">${precioTotal.toFixed(2)}</span>
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
                    ? `Carga ${selectorProducto.carga + 1} · se cobra por tapa`
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
                const lista = catalogoDe(ambito);
                if (lista.length === 0) {
                  return (
                    <p className="px-2 py-6 text-center text-sm text-gray-500">
                      {esCarga(ambito) ? 'No hay productos a granel dados de alta.' : 'No hay productos dados de alta.'}
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
                          ? 'Esta carga ya lleva todos los productos disponibles. Para llevar más de alguno, sube sus tapas en la lista.'
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
                              Ya está en la carga
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
              <h3 className="text-lg font-bold text-gray-900">¡Nota creada!</h3>
              {notaCreada.folio && (
                <p className="text-sm text-gray-500">
                  Folio <span className="font-semibold text-gray-800">{notaCreada.folio}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setNotaCreada(null); navigate('/notas'); }}
              className="w-full bg-blue hover:opacity-90 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
            >
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
