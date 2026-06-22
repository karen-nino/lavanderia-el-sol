import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { capitalizarNombre } from '../lib/texto';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const LABEL_CLS = 'block text-sm font-semibold text-gray-900 mb-2';

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

const FORM_INIT = {
  maquina_id:      '',
  cantidad_cargas: '1',
  ajuste:          '0',
  instrucciones:   '',
};

const TAMANOS = [
  { v: 'chico',  label: 'Chico'  },
  { v: 'grande', label: 'Grande' },
];
const TAMANO_LABEL = Object.fromEntries(TAMANOS.map(t => [t.v, t.label]));

const ENCARGO_INIT = {
  cliente_id:             '',
  tipo_prenda:            '',
  tamano:                 '',
  cantidad_cargas:        '1',
  ajuste:                 '0',
  pago_anticipado:        '',
  fecha_entrega:          '',
  tiempo_entrega:         '',
  instrucciones:          '',
  maquina_id:             '',
  activar_inmediatamente: '',
};

const TIEMPOS_ENTREGA = [
  { v: 'MANANA', label: 'Mañana' },
  { v: 'TARDE',  label: 'Tarde'  },
  { v: 'NOCHE',  label: 'Noche'  },
];
const TIEMPO_ENTREGA_LABEL = Object.fromEntries(TIEMPOS_ENTREGA.map(t => [t.v, t.label]));

const ENCARGO_STEPS = 7;

const formatMaquina = (m) => {
  if (!m) return '';
  if (m.tipo === 'lavadora_mediana') return `${m.nombre} — Mediana`;
  if (m.tipo === 'lavadora_jumbo')   return `${m.nombre} — Jumbo`;
  return m.nombre;
};

export default function NuevaNota() {
  const navigate = useNavigate();
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const [maquinas,          setMaquinas]          = useState([]);
  const [productosCatalogo, setProductosCatalogo] = useState([]);
  const [precios,           setPrecios]           = useState({ mediana: 70, jumbo: 70, secadora: 45, edredonJumbo: 80 });
  const [loadingData,       setLoadingData]       = useState(true);
  const [form,              setForm]              = useState(FORM_INIT);
  const [productosLista,    setProductosLista]    = useState([]);
  const [error,             setError]             = useState('');
  const [loading,           setLoading]           = useState(false);
  const [tipoServicio,      setTipoServicio]      = useState('');
  const [tipoOpen,          setTipoOpen]          = useState(false);
  const [tipoPrenda,        setTipoPrenda]        = useState('');
  const [prendaOpen,        setPrendaOpen]        = useState(false);
  const [maquinaOpen,       setMaquinaOpen]       = useState(false);
  const [maquinaEncargoOpen, setMaquinaEncargoOpen] = useState(false);
  const [encargoStep,       setEncargoStep]       = useState(1);
  const [encargoForm,       setEncargoForm]       = useState(ENCARGO_INIT);
  const [encargoProductos,  setEncargoProductos]  = useState([]);
  const [encargoLoading,    setEncargoLoading]    = useState(false);
  const [clientes,          setClientes]          = useState([]);
  const [clienteSearch,     setClienteSearch]     = useState('');
  const [nuevoClienteOpen,  setNuevoClienteOpen]  = useState(false);
  const [nuevoCliente,      setNuevoCliente]      = useState({ nombre: '', apellido: '', telefono: '' });
  const [creandoCliente,    setCreandoCliente]    = useState(false);
  const [folio,             setFolio]             = useState('');
  const [notaCreada,        setNotaCreada]        = useState(null);
  const tipoRef           = useRef(null);
  const prendaRef         = useRef(null);
  const maquinaRef        = useRef(null);
  const maquinaEncargoRef = useRef(null);

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

  useEffect(() => {
    if (!prendaOpen) return;
    const onMouseDown = (e) => {
      if (prendaRef.current && !prendaRef.current.contains(e.target)) {
        setPrendaOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [prendaOpen]);

  useEffect(() => {
    if (!maquinaOpen) return;
    const onMouseDown = (e) => {
      if (maquinaRef.current && !maquinaRef.current.contains(e.target)) {
        setMaquinaOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [maquinaOpen]);

  useEffect(() => {
    if (!maquinaEncargoOpen) return;
    const onMouseDown = (e) => {
      if (maquinaEncargoRef.current && !maquinaEncargoRef.current.contains(e.target)) {
        setMaquinaEncargoOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [maquinaEncargoOpen]);

  const precioPorTipo = (tipoMaquina, tipoPrendaArg) => {
    if (tipoMaquina === 'secadora') return precios.secadora;
    if (tipoMaquina === 'lavadora_jumbo' && tipoPrendaArg === 'EDREDON') return precios.edredonJumbo;
    if (tipoMaquina === 'lavadora_jumbo') return precios.jumbo;
    return precios.mediana;
  };
  const maquinaAutoservicio = maquinas.find(m => String(m.id) === String(form.maquina_id));
  const precioCargaAutoservicio = precioPorTipo(maquinaAutoservicio?.tipo, tipoPrenda);

  const ajusteNum      = Number(form.ajuste) || 0;
  const subtotalCargas = (Number(form.cantidad_cargas) || 1) * precioCargaAutoservicio;
  const subtotalProductos = productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    return sum + (prod ? (Number(prod.precio_unitario) || 0) * (Number(p.cantidad) || 0) : 0);
  }, 0);
  const precioTotal = subtotalCargas + ajusteNum + subtotalProductos;

  useEffect(() => {
    const promesas = [
      api.get('/maquinas'),
      api.get('/productos'),
      api.get('/ajustes'),
      api.get('/clientes'),
    ];
    promesas.push(esEdicion ? api.get(`/notas/${id}`) : api.get('/notas/next-folio'));

    Promise.all(promesas)
      .then((resultados) => {
        const [m, prod, cfg, cli, extra] = resultados;
        const nota = esEdicion ? extra : null;
        setFolio(esEdicion ? (nota?.folio ?? '') : (extra?.folio ?? ''));
        // En edición, incluir la máquina actual aunque no esté "disponible"
        const maquinasFiltradas = esEdicion && nota?.maquina_id
          ? m.filter(maq => maq.estado === 'disponible' || maq.id === nota.maquina_id)
          : m.filter(maq => maq.estado === 'disponible');
        setMaquinas(maquinasFiltradas);
        setProductosCatalogo(prod);
        if (cfg) {
          setPrecios({
            mediana:      cfg.precio_carga_mediana  != null ? Number(cfg.precio_carga_mediana)  : 70,
            jumbo:        cfg.precio_carga_jumbo    != null ? Number(cfg.precio_carga_jumbo)    : 70,
            secadora:     cfg.precio_carga_secadora != null ? Number(cfg.precio_carga_secadora) : 45,
            edredonJumbo: cfg.precio_edredon_jumbo  != null ? Number(cfg.precio_edredon_jumbo)  : 80,
          });
        }
        setClientes(cli);

        if (esEdicion && nota) {
          // Compat con notas viejas: modalidad=EDREDON significa autoservicio+edredón
          // si no tiene cliente_id, o por_encargo+edredón si lo tiene.
          const esEncargoLegacy = nota.modalidad === 'EDREDON' && nota.cliente_id;
          const esEncargo  = nota.modalidad === 'POR_ENCARGO' || esEncargoLegacy;
          const prendaNota = nota.tipo_prenda
            ?? (nota.modalidad === 'EDREDON' ? 'EDREDON' : 'ROPA');

          if (esEncargo) {
            setTipoServicio('POR_ENCARGO');
          } else {
            setTipoServicio('AUTOSERVICIO');
            setTipoPrenda(prendaNota);
          }
          const prods = (nota.productos || []).map(p => ({
            producto_id: String(p.producto_id),
            cantidad:    String(p.cantidad),
          }));

          if (esEncargo) {
            setEncargoForm({
              cliente_id:             nota.cliente_id     ? String(nota.cliente_id) : '',
              tipo_prenda:            prendaNota,
              tamano:                 nota.tamano         ?? '',
              cantidad_cargas:        nota.cantidad_cargas != null ? String(nota.cantidad_cargas) : '1',
              ajuste:                 nota.ajuste         != null ? String(nota.ajuste)      : '0',
              pago_anticipado:        nota.estado_pago === 'PAGADO' ? 'SI' : 'NO',
              fecha_entrega:          nota.fecha_entrega  ? String(nota.fecha_entrega).slice(0, 10) : '',
              tiempo_entrega:         nota.tiempo_entrega ?? '',
              instrucciones:          nota.instrucciones  ?? '',
              maquina_id:             nota.maquina_id     ? String(nota.maquina_id) : '',
              activar_inmediatamente: '',
            });
            setEncargoProductos(prods);
          } else {
            // AUTOSERVICIO o EDREDON usan el mismo formulario
            setForm({
              maquina_id:      nota.maquina_id     ? String(nota.maquina_id) : '',
              cantidad_cargas: nota.cantidad_cargas != null ? String(nota.cantidad_cargas) : '1',
              ajuste:          nota.ajuste         != null ? String(nota.ajuste)           : '0',
              instrucciones:   nota.instrucciones  ?? '',
            });
            setProductosLista(prods);
          }
        }
      })
      .finally(() => setLoadingData(false));
  }, [id, esEdicion]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const agregarProducto = () =>
    setProductosLista(prev => [...prev, { producto_id: '', cantidad: '1' }]);

  const actualizarProducto = (i, field, value) =>
    setProductosLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarProducto = (i) =>
    setProductosLista(prev => prev.filter((_, idx) => idx !== i));

  const handleEncargoChange = (e) => {
    const { name, value } = e.target;
    setEncargoForm(f => ({ ...f, [name]: value }));
  };

  const agregarEncargoProducto = () =>
    setEncargoProductos(prev => [...prev, { producto_id: '', cantidad: '1' }]);

  const actualizarEncargoProducto = (i, field, value) =>
    setEncargoProductos(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarEncargoProducto = (i) =>
    setEncargoProductos(prev => prev.filter((_, idx) => idx !== i));

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

  const maquinaEncargo        = maquinas.find(m => String(m.id) === String(encargoForm.maquina_id));
  const precioCargaEncargo    = precioPorTipo(maquinaEncargo?.tipo, encargoForm.tipo_prenda);
  const encargoCargas         = Number(encargoForm.cantidad_cargas) || 1;
  const encargoSubtotalCargas = encargoCargas * precioCargaEncargo;
  const encargoAjuste         = Number(encargoForm.ajuste)      || 0;
  const encargoSubtotalProductos = encargoProductos.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    return sum + (prod ? (Number(prod.precio_unitario) || 0) * (Number(p.cantidad) || 0) : 0);
  }, 0);
  const encargoPrecioTotal    = encargoSubtotalCargas + encargoAjuste + encargoSubtotalProductos;
  const clienteSeleccionado   = clientes.find(c => String(c.id) === String(encargoForm.cliente_id));
  const sinAcentos = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const clienteSearchQ    = sinAcentos(clienteSearch.trim());
  const clientesFiltrados = clienteSearchQ
    ? clientes.filter(c =>
        sinAcentos(c.nombre).includes(clienteSearchQ) ||
        sinAcentos(c.apellido).includes(clienteSearchQ) ||
        sinAcentos(c.telefono).includes(clienteSearchQ)
      )
    : clientes;

  const encargoPuedeAvanzar = (() => {
    if (encargoStep === 1) return !!encargoForm.cliente_id;
    if (encargoStep === 2) return !!encargoForm.tipo_prenda && !!encargoForm.tamano;
    if (encargoStep === 3) {
      if (esEdicion) return true;
      if (!encargoForm.maquina_id) return true;
      return !!encargoForm.activar_inmediatamente;
    }
    if (encargoStep === 4) {
      const c = Number(encargoForm.cantidad_cargas);
      return !Number.isNaN(c) && c >= 1;
    }
    if (encargoStep === 5) return !!encargoForm.pago_anticipado;
    return true;
  })();

  const handleEncargoSubmit = async () => {
    setError('');
    setEncargoLoading(true);
    try {
      // En Proceso solo si hay máquina y se activó inmediatamente; si no, En Espera.
      const estadoInicial =
        encargoForm.maquina_id && encargoForm.activar_inmediatamente === 'SI'
          ? 'EN_PROCESO'
          : 'EN_ESPERA';
      const payload = {
        modalidad:       'POR_ENCARGO',
        tipo_prenda:     encargoForm.tipo_prenda || 'ROPA',
        estado:          estadoInicial,
        cliente_id:      Number(encargoForm.cliente_id),
        tamano:          encargoForm.tamano,
        cantidad_cargas: encargoCargas,
        precio_base:     precioCargaEncargo,
        ajuste:          encargoAjuste,
        estado_pago:     encargoForm.pago_anticipado === 'SI' ? 'PAGADO' : 'DEBE',
        fecha_entrega:   encargoForm.fecha_entrega  || undefined,
        tiempo_entrega:  encargoForm.tiempo_entrega || undefined,
        instrucciones:   encargoForm.instrucciones  || undefined,
        maquina_id:      encargoForm.maquina_id ? Number(encargoForm.maquina_id) : undefined,
        sucursal:        'lopez_cotilla',
        productos:       encargoProductos
          .filter(p => p.producto_id && p.cantidad)
          .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
      };
      if (esEdicion) {
        await api.patch(`/notas/${id}`, payload);
        navigate(`/notas/${id}`);
      } else {
        const creada = await api.post('/notas', payload);
        if (encargoForm.maquina_id && encargoForm.activar_inmediatamente === 'SI') {
          await api.patch(`/maquinas/${encargoForm.maquina_id}/estado`, { estado: 'en_uso' });
        }
        setNotaCreada(creada);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setEncargoLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (tipoServicio !== 'AUTOSERVICIO') return;
    setError('');
    setLoading(true);

    const cargas = Number(form.cantidad_cargas) || 1;

    const payload = {
      modalidad:       'AUTOSERVICIO',
      tipo_prenda:     tipoPrenda || 'ROPA',
      estado_pago:     'PAGADO',
      sucursal:        'lopez_cotilla',
      instrucciones:   form.instrucciones || undefined,
      maquina_id:      form.maquina_id ? Number(form.maquina_id) : undefined,
      cantidad_cargas: cargas,
      precio_base:     precioCargaAutoservicio,
      ajuste:          ajusteNum,
      productos:       productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

    try {
      if (esEdicion) {
        await api.patch(`/notas/${id}`, payload);
        navigate(`/notas/${id}`);
      } else {
        const creada = await api.post('/notas', payload);
        if (form.maquina_id) {
          await api.patch(`/maquinas/${form.maquina_id}/estado`, { estado: 'en_uso' });
        }
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
          className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition-colors"
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
                    className={`h-1.5 w-8 rounded-full ${
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

            {/* Paso 2 — Tipo de prenda + Tamaño */}
            {encargoStep === 2 && (
              <div className="space-y-6">
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-gray-900">Tipo de prenda</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {TIPOS_PRENDA.map(opt => {
                      const selected = encargoForm.tipo_prenda === opt.v;
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setEncargoForm(f => {
                            const next = { ...f, tipo_prenda: opt.v };
                            if (opt.v === 'EDREDON' && f.maquina_id) {
                              const m = maquinas.find(x => String(x.id) === String(f.maquina_id));
                              if (m && m.tipo !== 'lavadora_jumbo') {
                                next.maquina_id = '';
                                next.activar_inmediatamente = '';
                              }
                            }
                            return next;
                          })}
                          className={`py-8 border-2 rounded-xl font-semibold text-lg transition-colors ${
                            selected
                              ? 'border-blue bg-light-blue text-blue-700'
                              : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-gray-900">Tamaño del encargo</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {TAMANOS.map(t => {
                      const selected = encargoForm.tamano === t.v;
                      return (
                        <button
                          key={t.v}
                          type="button"
                          onClick={() => setEncargoForm(f => ({ ...f, tamano: t.v }))}
                          className={`py-8 border-2 rounded-xl font-semibold text-lg transition-colors ${
                            selected
                              ? 'border-blue bg-light-blue text-blue-700'
                              : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Paso 4 — Cantidad de cargas + Ajuste */}
            {encargoStep === 4 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-900">Cargas</h2>
                <div>
                  <label className={LABEL_CLS}>
                    Cantidad de cargas <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mb-1.5">
                    Precio base por carga: ${precioCargaEncargo.toFixed(2)} MXN
                    {maquinaEncargo && ` (${maquinaEncargo.tipo === 'lavadora_jumbo' ? 'Jumbo' : 'Mediana'})`}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" name="cantidad_cargas" min="1" step="1" required
                      value={encargoForm.cantidad_cargas} onChange={handleEncargoChange}
                      placeholder="1"
                      className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                    <button
                      type="button"
                      onClick={() => setEncargoForm(f => ({ ...f, cantidad_cargas: String(Math.max(1, (Number(f.cantidad_cargas) || 1) - 1)) }))}
                      disabled={(Number(encargoForm.cantidad_cargas) || 1) <= 1}
                      aria-label="Disminuir cargas"
                      className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => setEncargoForm(f => ({ ...f, cantidad_cargas: String((Number(f.cantidad_cargas) || 0) + 1) }))}
                      aria-label="Aumentar cargas"
                      className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-xs text-blue mt-1 font-medium">
                    Subtotal cargas: ${encargoSubtotalCargas.toFixed(2)}
                  </p>
                </div>
                <div>
                  <label className={LABEL_CLS}>Ajuste ($)</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                      <input
                        type="number" name="ajuste" step="10"
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
                  <p className="text-xs text-gray-400 mt-1">Descuento (negativo) o cargo extra (positivo).</p>
                </div>
              </div>
            )}

            {/* Paso 5 — Pago Anticipado */}
            {encargoStep === 5 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Pago Anticipado</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { v: 'SI', label: 'Sí' },
                    { v: 'NO', label: 'No' },
                  ].map(opt => {
                    const selected = encargoForm.pago_anticipado === opt.v;
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setEncargoForm(f => ({ ...f, pago_anticipado: opt.v }))}
                        className={`py-8 border-2 rounded-xl font-semibold text-lg transition-colors ${
                          selected
                            ? 'border-blue bg-light-blue text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Paso 6 — Fecha de entrega + Instrucciones */}
            {encargoStep === 6 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-900">Entrega</h2>
                <div>
                  <label className={LABEL_CLS}>Fecha de entrega</label>
                  <div className="relative">
                    <input
                      type="date" name="fecha_entrega"
                      value={encargoForm.fecha_entrega} onChange={handleEncargoChange}
                      className={`${INPUT_CLS} appearance-none min-w-0 block bg-white h-[54px] ${
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
                          onClick={() => setEncargoForm(f => ({
                            ...f,
                            tiempo_entrega: f.tiempo_entrega === t.v ? '' : t.v,
                          }))}
                          className={`py-4 border-2 rounded-xl font-semibold text-base transition-colors ${
                            selected
                              ? 'border-blue bg-light-blue text-blue-700'
                              : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
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

            {/* Paso 3 — Máquina */}
            {encargoStep === 3 && (() => {
              const maquinasDisponibles = encargoForm.tipo_prenda === 'EDREDON'
                ? maquinas.filter(m => m.tipo === 'lavadora_jumbo')
                : maquinas;
              return (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-900">Máquina</h2>

                <div ref={maquinaEncargoRef} className="relative">
                  <label className={LABEL_CLS}>Máquina</label>
                  {(() => {
                    const maquinaSel = maquinas.find(m => String(m.id) === String(encargoForm.maquina_id));
                    const maquinaLabel = formatMaquina(maquinaSel);
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setMaquinaEncargoOpen(o => !o)}
                          className={`w-full px-4 py-3.5 border rounded-lg bg-white text-left flex items-center justify-between transition-colors ${
                            maquinaEncargoOpen
                              ? 'border-blue-500 ring-1 ring-blue-500'
                              : encargoForm.maquina_id
                                ? 'border-green-600'
                                : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <span className={encargoForm.maquina_id ? 'text-gray-900' : 'text-gray-400'}>
                            {maquinaLabel || 'Sin asignar'}
                          </span>
                          {encargoForm.maquina_id && !maquinaEncargoOpen ? (
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg
                              className={`w-5 h-5 text-gray-500 transition-transform ${maquinaEncargoOpen ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>

                        {maquinaEncargoOpen && (
                          <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
                            <button
                              type="button"
                              onClick={() => {
                                setEncargoForm(f => ({ ...f, maquina_id: '', activar_inmediatamente: '' }));
                                setMaquinaEncargoOpen(false);
                              }}
                              className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 border-b last:border-0 border-gray-100"
                            >
                              <span className="text-base text-gray-500 italic">Sin asignar</span>
                              <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                !encargoForm.maquina_id ? 'border-blue bg-blue' : 'border-gray-300'
                              }`}>
                                {!encargoForm.maquina_id && (
                                  <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                            </button>
                            {maquinasDisponibles.map(m => {
                              const selected = String(encargoForm.maquina_id) === String(m.id);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    setEncargoForm(f => ({ ...f, maquina_id: String(m.id) }));
                                    setMaquinaEncargoOpen(false);
                                  }}
                                  className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 border-b last:border-0 border-gray-100"
                                >
                                  <span className="text-base text-gray-900">
                                    {formatMaquina(m)}
                                  </span>
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
                      </>
                    );
                  })()}
                  {maquinasDisponibles.length === 0 && (
                    <p className="text-xs text-red-600 mt-1">
                      {encargoForm.tipo_prenda === 'EDREDON'
                        ? 'No hay máquinas jumbo disponibles en este momento.'
                        : 'No hay máquinas disponibles en este momento.'}
                    </p>
                  )}
                </div>

                {encargoForm.maquina_id && !esEdicion && (
                  <div>
                    <label className={LABEL_CLS}>Activar inmediatamente</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { v: 'SI', label: 'Sí' },
                        { v: 'NO', label: 'No' },
                      ].map(opt => {
                        const selected = encargoForm.activar_inmediatamente === opt.v;
                        return (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setEncargoForm(f => ({ ...f, activar_inmediatamente: opt.v }))}
                            className={`py-8 border-2 rounded-xl font-semibold text-lg transition-colors ${
                              selected
                                ? 'border-blue bg-light-blue text-blue-700'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
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
              );
            })()}

            {/* Paso 7 — Productos + Resumen */}
            {encargoStep === 7 && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold text-gray-900">Productos</h2>
                    {encargoProductos.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {encargoProductos.length} {encargoProductos.length === 1 ? 'producto' : 'productos'}
                      </span>
                    )}
                  </div>

                  {encargoProductos.length === 0 ? (
                    <button
                      type="button"
                      onClick={agregarEncargoProducto}
                      className="w-full py-8 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40 transition-colors flex flex-col items-center justify-center gap-2"
                    >
                      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-sm font-medium">Agregar producto</span>
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {encargoProductos.map((item, i) => {
                        const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
                        const cant = Number(item.cantidad) || 0;
                        const subtotal = prod ? (Number(prod.precio_unitario) || 0) * cant : 0;
                        return (
                          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <select
                                value={item.producto_id}
                                onChange={e => actualizarEncargoProducto(i, 'producto_id', e.target.value)}
                                className={`flex-1 ${INPUT_CLS}`}
                              >
                                <option value="">Selecciona un producto…</option>
                                {productosCatalogo.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre}{p.precio_unitario ? ` — $${Number(p.precio_unitario).toFixed(2)}` : ''} ({Number(p.stock_disponible ?? p.stock_actual)} {p.unidad})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => eliminarEncargoProducto(i)}
                                aria-label="Eliminar producto"
                                className="flex-shrink-0 px-3 py-3.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            <div className="flex items-end justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Cantidad</p>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => actualizarEncargoProducto(i, 'cantidad', String(Math.max(1, cant - 1)))}
                                    disabled={cant <= 1}
                                    aria-label="Disminuir cantidad"
                                    className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    −
                                  </button>
                                  <span className="w-10 text-center text-base font-medium text-gray-900">{cant}</span>
                                  <button
                                    type="button"
                                    onClick={() => actualizarEncargoProducto(i, 'cantidad', String(cant + 1))}
                                    aria-label="Aumentar cantidad"
                                    className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-semibold hover:bg-gray-50 transition-colors"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              {subtotal > 0 && (
                                <div className="text-right">
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtotal</p>
                                  <p className="text-lg font-bold text-blue-700">${subtotal.toFixed(2)}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={agregarEncargoProducto}
                        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Agregar otro producto
                      </button>
                    </div>
                  )}
                </div>

                {/* Resumen */}
                <div className="bg-light-blue border border-blue-200 rounded-xl p-4">
                  <p className="text-xs font-medium text-blue uppercase tracking-wide mb-2">
                    Resumen
                  </p>
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
                      <span>Prenda</span>
                      <span className="font-medium">{PRENDA_LABEL[encargoForm.tipo_prenda] ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tamaño</span>
                      <span className="font-medium">{TAMANO_LABEL[encargoForm.tamano] ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pago Anticipado</span>
                      <span className="font-medium">
                        {encargoForm.pago_anticipado === 'SI' ? 'Sí'
                          : encargoForm.pago_anticipado === 'NO' ? 'No' : '—'}
                      </span>
                    </div>
                    {encargoForm.fecha_entrega && (
                      <div className="flex justify-between">
                        <span>Entrega</span>
                        <span className="font-medium">{encargoForm.fecha_entrega}</span>
                      </div>
                    )}
                    {encargoForm.tiempo_entrega && (
                      <div className="flex justify-between">
                        <span>Tiempo</span>
                        <span className="font-medium">{TIEMPO_ENTREGA_LABEL[encargoForm.tiempo_entrega]}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Máquina</span>
                      <span className="font-medium">
                        {(() => {
                          const maquinaSel = maquinas.find(m => String(m.id) === String(encargoForm.maquina_id));
                          return maquinaSel ? formatMaquina(maquinaSel) : 'Sin asignar';
                        })()}
                      </span>
                    </div>
                    {encargoForm.maquina_id && !esEdicion && encargoForm.activar_inmediatamente && (
                      <div className="flex justify-between">
                        <span>Activar al crear</span>
                        <span className="font-medium">
                          {encargoForm.activar_inmediatamente === 'SI' ? 'Sí' : 'No'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 mb-2 text-sm text-blue border-t border-blue-200 pt-3">
                    <div className="flex justify-between">
                      <span>Cargas ({encargoCargas} × ${precioCargaEncargo.toFixed(2)})</span>
                      <span>${encargoSubtotalCargas.toFixed(2)}</span>
                    </div>
                    {encargoAjuste !== 0 && (
                      <div className="flex justify-between">
                        <span>Ajuste</span>
                        <span>{encargoAjuste > 0 ? '+' : ''}${encargoAjuste.toFixed(2)}</span>
                      </div>
                    )}
                    {encargoSubtotalProductos > 0 && (
                      <div className="flex justify-between">
                        <span>Productos</span>
                        <span>${encargoSubtotalProductos.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-3xl font-bold text-blue-700 border-t border-blue-200 pt-2">
                    ${encargoPrecioTotal.toFixed(2)}
                  </p>
                </div>
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
        <>
        {/* Tipo de Prenda */}
        <div ref={prendaRef} className="relative">
          <label className={LABEL_CLS}>Tipo de Prenda</label>
          <button
            type="button"
            onClick={() => setPrendaOpen(o => !o)}
            className={`w-full px-4 py-3.5 border rounded-lg bg-white text-left flex items-center justify-between transition-colors ${
              prendaOpen
                ? 'border-blue-500 ring-1 ring-blue-500'
                : tipoPrenda
                  ? 'border-green-600'
                  : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <span className={tipoPrenda ? 'text-gray-900' : 'text-gray-400'}>
              {tipoPrenda ? PRENDA_LABEL[tipoPrenda] : 'Seleccionar'}
            </span>
            {tipoPrenda && !prendaOpen ? (
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className={`w-5 h-5 text-gray-500 transition-transform ${prendaOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {prendaOpen && (
            <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
              {TIPOS_PRENDA.map(opt => {
                const selected = tipoPrenda === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => { setTipoPrenda(opt.v); setPrendaOpen(false); }}
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

        {tipoPrenda && (
        <>
        <div className="py-3"><div className="border-t border-gray-200" /></div>

        <div className='space-y-8'>

          {/* Máquina */}
          <div ref={maquinaRef} className="relative">
            <label className={LABEL_CLS}>Máquina</label>
            {(() => {
              const maquinaSel = maquinas.find(m => String(m.id) === String(form.maquina_id));
              const maquinaLabel = formatMaquina(maquinaSel);
              return (
                <>
                  <button
                    type="button"
                    onClick={() => setMaquinaOpen(o => !o)}
                    className={`w-full px-4 py-3.5 border rounded-lg bg-white text-left flex items-center justify-between transition-colors ${
                      maquinaOpen
                        ? 'border-blue-500 ring-1 ring-blue-500'
                        : form.maquina_id
                          ? 'border-green-600'
                          : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <span className={form.maquina_id ? 'text-gray-900' : 'text-gray-400'}>
                      {maquinaLabel || 'Sin asignar'}
                    </span>
                    {form.maquina_id && !maquinaOpen ? (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg
                        className={`w-5 h-5 text-gray-500 transition-transform ${maquinaOpen ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>

                  {maquinaOpen && (
                    <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
                      <button
                        type="button"
                        onClick={() => { setForm(f => ({ ...f, maquina_id: '' })); setMaquinaOpen(false); }}
                        className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 border-b last:border-0 border-gray-100"
                      >
                        <span className="text-base text-gray-500 italic">Sin asignar</span>
                        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          !form.maquina_id ? 'border-blue bg-blue' : 'border-gray-300'
                        }`}>
                          {!form.maquina_id && (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      </button>
                      {maquinas.map(m => {
                        const selected = String(form.maquina_id) === String(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setForm(f => ({ ...f, maquina_id: String(m.id) })); setMaquinaOpen(false); }}
                            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-gray-50 border-b last:border-0 border-gray-100"
                          >
                            <span className="text-base text-gray-900">
                              {formatMaquina(m)}
                            </span>
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
                </>
              );
            })()}
            {maquinas.length === 0 && (
              <p className="text-xs text-red-600 mt-1">No hay máquinas disponibles en este momento.</p>
            )}
          </div>

          {/* Cantidad de cargas */}
          <div>
            <label className={LABEL_CLS}>
              Cantidad de cargas <span className="text-red-500">*</span>
            </label>
            {/* <p className="text-xs text-gray-400 mb-1.5">Precio base por carga: ${precioCargaAutoservicio.toFixed(2)} MXN</p> */}
            <div className="flex items-center gap-2">
              <input
                type="number" name="cantidad_cargas" min="1" step="1" required
                value={form.cantidad_cargas} onChange={handleChange}
                placeholder="1"
                className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
              />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, cantidad_cargas: String(Math.max(1, (Number(f.cantidad_cargas) || 1) - 1)) }))}
                disabled={(Number(form.cantidad_cargas) || 1) <= 1}
                aria-label="Disminuir cargas"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, cantidad_cargas: String((Number(f.cantidad_cargas) || 0) + 1) }))}
                aria-label="Aumentar cargas"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                +
              </button>
            </div>
            <p className="text-xs text-blue mt-1 font-medium">
              Subtotal cargas: ${subtotalCargas.toFixed(2)}
            </p>
          </div>

          {/* Ajuste */}
          <div>
            <label className={LABEL_CLS}>Ajuste ($)</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" name="ajuste" step="10"
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
            <p className="text-xs text-gray-400 mt-1">Descuento (negativo) o cargo extra (positivo)</p>
          </div>

        {/* ── Productos ────────────────────────────────────── */}

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className={LABEL_CLS + ' mb-0'}>Productos</h2>
            {productosLista.length > 0 && (
              <span className="text-xs text-gray-500">
                {productosLista.length} {productosLista.length === 1 ? 'producto' : 'productos'}
              </span>
            )}
          </div>

          {productosLista.length === 0 ? (
            <button
              type="button"
              onClick={agregarProducto}
              className="w-full py-8 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40 transition-colors flex flex-col items-center justify-center gap-2"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium">Agregar producto</span>
            </button>
          ) : (
            <div className="space-y-3">
              {productosLista.map((item, i) => {
                const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
                const cant = Number(item.cantidad) || 0;
                const subtotal = prod ? (Number(prod.precio_unitario) || 0) * cant : 0;
                return (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={item.producto_id}
                        onChange={e => actualizarProducto(i, 'producto_id', e.target.value)}
                        className={`flex-1 ${INPUT_CLS}`}
                      >
                        <option value="">Selecciona un producto…</option>
                        {productosCatalogo.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}{p.precio_unitario ? ` — $${Number(p.precio_unitario).toFixed(2)}` : ''} ({Number(p.stock_disponible ?? p.stock_actual)} {p.unidad})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => eliminarProducto(i)}
                        aria-label="Eliminar producto"
                        className="flex-shrink-0 px-3 py-3.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Cantidad</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => actualizarProducto(i, 'cantidad', String(Math.max(1, cant - 1)))}
                            disabled={cant <= 1}
                            aria-label="Disminuir cantidad"
                            className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            −
                          </button>
                          <span className="w-10 text-center text-base font-medium text-gray-900">{cant}</span>
                          <button
                            type="button"
                            onClick={() => actualizarProducto(i, 'cantidad', String(cant + 1))}
                            aria-label="Aumentar cantidad"
                            className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 text-lg font-semibold hover:bg-gray-50 transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {subtotal > 0 && (
                        <div className="text-right">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subtotal</p>
                          <p className="text-lg font-bold text-blue-700">${subtotal.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={agregarProducto}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:text-blue hover:border-blue-400 hover:bg-light-blue/40 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Agregar otro producto
              </button>
            </div>
          )}
        </div>

        </div>

        {/* ── Precio Total ─────────────────────────────────── */}
        {(() => {
          const maquinaSel = maquinas.find(m => String(m.id) === String(form.maquina_id));
          return (
            <div className="bg-light-blue border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-medium text-blue uppercase tracking-wide mb-2">
                Resumen
              </p>
              <div className="space-y-1 mb-3 text-sm text-blue-700">
                <div className="flex justify-between">
                  <span>Servicio</span>
                  <span className="font-medium">{TIPO_LABEL[tipoServicio]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Prenda</span>
                  <span className="font-medium">{PRENDA_LABEL[tipoPrenda]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Máquina</span>
                  <span className="font-medium">
                    {maquinaSel ? formatMaquina(maquinaSel) : 'Sin asignar'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 mb-2 text-sm text-blue border-t border-blue-200 pt-3">
                <div className="flex justify-between">
                  <span>Cargas ({form.cantidad_cargas || 1} × ${precioCargaAutoservicio.toFixed(2)})</span>
                  <span>${subtotalCargas.toFixed(2)}</span>
                </div>
                {ajusteNum !== 0 && (
                  <div className="flex justify-between">
                    <span>Ajuste</span>
                    <span>{ajusteNum > 0 ? '+' : ''}${ajusteNum.toFixed(2)}</span>
                  </div>
                )}
                {subtotalProductos > 0 && (
                  <div className="flex justify-between">
                    <span>Productos</span>
                    <span>${subtotalProductos.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <p className="text-3xl font-bold text-blue-700 border-t border-blue-200 pt-2">
                ${precioTotal.toFixed(2)}
              </p>
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
            type="submit" disabled={loading}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading
              ? (esEdicion ? 'Guardando...' : 'Creando...')
              : (esEdicion ? 'Guardar cambios' : 'Crear nota')}
          </button>
        </div>
        </>
        )}
        </>
        )}
      </form>

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
