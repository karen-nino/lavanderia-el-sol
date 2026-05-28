import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const LABEL_CLS = 'block text-sm font-semibold text-gray-900 mb-2';

const INPUT_DISABLED_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base bg-gray-50 text-gray-400 cursor-not-allowed placeholder:text-gray-400';

const TIPOS_SERVICIO = [
  { v: 'POR_ENCARGO',  label: 'Por Encargo'  },
  { v: 'AUTOSERVICIO', label: 'Autoservicio' },
];
const TIPO_LABEL = Object.fromEntries(TIPOS_SERVICIO.map(t => [t.v, t.label]));

const TIPOS_PRENDA = [
  { v: 'ROPA',    label: 'Ropa'    },
  { v: 'EDREDON', label: 'Edredón' },
];
const PRENDA_LABEL = Object.fromEntries(TIPOS_PRENDA.map(t => [t.v, t.label]));

const FORM_INIT = {
  maquina_id:       '',
  cantidad_cargas:  '1',
  ajuste:           '0',
  notas:            '',
  cliente_nombre:   '',
  cliente_telefono: '',
};

export default function NuevaNota() {
  const navigate = useNavigate();
  const [maquinas,          setMaquinas]          = useState([]);
  const [productosCatalogo, setProductosCatalogo] = useState([]);
  const [precioCarga,       setPrecioCarga]       = useState(70);
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
  const [step,              setStep]              = useState(1);
  const tipoRef    = useRef(null);
  const prendaRef  = useRef(null);
  const maquinaRef = useRef(null);

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

  const ajusteNum      = Number(form.ajuste) || 0;
  const subtotalCargas = (Number(form.cantidad_cargas) || 1) * precioCarga;
  const subtotalProductos = productosLista.reduce((sum, p) => {
    const prod = productosCatalogo.find(x => String(x.id) === String(p.producto_id));
    return sum + (prod ? (Number(prod.precio_unitario) || 0) * (Number(p.cantidad) || 0) : 0);
  }, 0);
  const precioTotal = subtotalCargas + ajusteNum + subtotalProductos;

  useEffect(() => {
    Promise.all([api.get('/maquinas'), api.get('/productos'), api.get('/configuracion')])
      .then(([m, prod, cfg]) => {
        setMaquinas(m.filter(maq => maq.estado === 'disponible'));
        setProductosCatalogo(prod);
        if (cfg?.precio_autoservicio) setPrecioCarga(Number(cfg.precio_autoservicio));
      })
      .finally(() => setLoadingData(false));
  }, []);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step !== 2) {
      setStep(2);
      return;
    }
    setError('');
    setLoading(true);

    const cargas = Number(form.cantidad_cargas) || 1;
    const prendaTxt = tipoPrenda ? `Prenda: ${PRENDA_LABEL[tipoPrenda]} — ` : '';

    const payload = {
      modalidad:       'AUTOSERVICIO',
      estado_pago:     'PAGADO',
      sucursal:        'lopez_cotilla',
      descripcion:     `${prendaTxt}Cargas: ${cargas}`,
      notas:           form.notas || undefined,
      maquina_id:      form.maquina_id ? Number(form.maquina_id) : undefined,
      cantidad_cargas: cargas,
      precio_base:     precioCarga,
      ajuste:          ajusteNum,
      productos:       productosLista
        .filter(p => p.producto_id && p.cantidad)
        .map(p => ({ producto_id: Number(p.producto_id), cantidad: Number(p.cantidad) })),
    };

    try {
      await api.post('/notas', payload);
      navigate('/notas');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
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
          <h1 className="text-lg font-bold text-gray-900 leading-tight">Nueva Nota</h1>
          <p className="text-sm text-gray-500">Crea una nueva nota</p>
        </div>
      </div>

      {tipoServicio === 'AUTOSERVICIO' && tipoPrenda && (
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              step === 1 ? 'bg-indigo-600 text-white' : 'bg-green-600 text-white'
            }`}>
              {step === 1 ? '1' : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <span className={`text-sm font-medium ${step === 1 ? 'text-gray-900' : 'text-gray-500'}`}>Servicio</span>
          </div>
          <div className="flex-1 h-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              step === 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              2
            </span>
            <span className={`text-sm font-medium ${step === 2 ? 'text-gray-900' : 'text-gray-400'}`}>Cliente</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── # Nota ──────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2"># Nota</label>
          <input
            type="text" disabled placeholder="Se asignará al guardar"
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
                      selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
            <p className="text-sm text-gray-500">Formulario de Por Encargo próximamente.</p>
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
                      selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
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
        {step === 1 && (
        <>
        <div className="py-3"><div className="border-t border-gray-200" /></div>

        <div className='space-y-5'>

          {/* Máquina */}
          <div ref={maquinaRef} className="relative">
            <label className={LABEL_CLS}>Máquina</label>
            {(() => {
              const maquinaSel = maquinas.find(m => String(m.id) === String(form.maquina_id));
              const maquinaLabel = maquinaSel
                ? `${maquinaSel.nombre} — ${maquinaSel.tipo.replace(/_/g, ' ')}`
                : '';
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
                          !form.maquina_id ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
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
                              {m.nombre} — {m.tipo.replace(/_/g, ' ')}
                            </span>
                            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              selected ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
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
            {/* <p className="text-xs text-gray-400 mb-1.5">Precio base por carga: ${precioCarga.toFixed(2)} MXN</p> */}
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
            <p className="text-xs text-indigo-600 mt-1 font-medium">
              Subtotal cargas: ${subtotalCargas.toFixed(2)}
            </p>
          </div>

          {/* Ajuste */}
          <div>
            <label className={LABEL_CLS}>Ajuste ($)</label>
            <input
              type="number" name="ajuste" step="0.01"
              value={form.ajuste} onChange={handleChange}
              placeholder="Ej. -10 para descuento, 20 para cargo extra"
              className={INPUT_CLS}
            />
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
              className="w-full py-8 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors flex flex-col items-center justify-center gap-2"
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
                          <p className="text-lg font-bold text-indigo-700">${subtotal.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={agregarProducto}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Agregar otro producto
              </button>
            </div>
          )}
        </div>

          {/* Instrucciones */}

          <div className="py-3"><div className="border-t border-gray-200" /></div>

          <div>
            <label className={LABEL_CLS}>Instrucciones</label>
            <textarea
              name="notas" value={form.notas} onChange={handleChange} rows={5}
              placeholder="Instrucciones especiales..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>


        </>
        )}

        {step === 2 && (
        <>
        <div className="py-3"><div className="border-t border-gray-200" /></div>

        <div className='space-y-5'>
          {/* Cliente */}
          <div>
            <label className={LABEL_CLS}>Nombre del cliente</label>
            <input
              type="text" name="cliente_nombre"
              value={form.cliente_nombre} onChange={handleChange}
              placeholder="Ej. Juan Pérez"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Teléfono</label>
            <input
              type="tel" name="cliente_telefono"
              value={form.cliente_telefono} onChange={handleChange}
              placeholder="Ej. 333 123 4567"
              className={INPUT_CLS}
            />
          </div>
        </div>
        </>
        )}

        {/* ── Precio Total ─────────────────────────────────── */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-2">
            Precio total
          </p>
          <div className="space-y-1 mb-2 text-sm text-indigo-600">
            <div className="flex justify-between">
              <span>Cargas ({form.cantidad_cargas || 1} × ${precioCarga.toFixed(2)})</span>
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
          <p className="text-3xl font-bold text-indigo-700 border-t border-indigo-200 pt-2">
            ${precioTotal.toFixed(2)}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-4">
          {step === 1 ? (
            <>
              <button
                key="cancelar"
                type="button" onClick={() => navigate(-1)}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                key="siguiente"
                type="button" onClick={() => setStep(2)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                Siguiente
              </button>
            </>
          ) : (
            <>
              <button
                key="atras"
                type="button" onClick={() => setStep(1)}
                className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Atrás
              </button>
              <button
                key="crear"
                type="submit" disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {loading ? 'Creando...' : 'Crear nota'}
              </button>
            </>
          )}
        </div>
        </>
        )}
        </>
        )}
      </form>
    </div>
  );
}
