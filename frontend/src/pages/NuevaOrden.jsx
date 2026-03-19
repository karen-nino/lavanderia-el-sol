import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const INPUT_DISABLED_CLS =
  'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed';

// Precio por carga para Autoservicio
const PRECIO_POR_CARGA = 70;

const TIPOS = [
  { val: 'AUTOSERVICIO', label: 'Autoservicio',  desc: 'Pago directo, precio libre' },
  { val: 'EDREDON',      label: 'Edredón',       desc: 'Precio base + ajuste'       },
  { val: 'POR_ENCARGO',  label: 'Por encargo',   desc: 'Cliente registrado'          },
];

const FORM_INIT = {
  modalidad:       'POR_ENCARGO',
  cliente_id:      '',
  tamano:          '',
  ajuste:          '0',
  estado_pago:     'PAGADO',
  fecha_entrega:   '',
  descripcion:     '',
  peso_kg:         '',
  notas:           '',
  maquina_id:      '',
  cantidad_cargas: '1',  // solo AUTOSERVICIO
};

export default function NuevaOrden() {
  const navigate = useNavigate();
  const [clientes,          setClientes]          = useState([]);
  const [maquinas,          setMaquinas]          = useState([]);
  const [insumos,           setInsumos]           = useState([]);
  const [articulosCatalogo, setArticulosCatalogo] = useState([]);
  const [loadingData,       setLoadingData]       = useState(true);
  const [form,         setForm]         = useState(FORM_INIT);
  const [insumosLista,      setInsumosLista]      = useState([]);
  const [articulosAutoLista, setArticulosAutoLista] = useState([]);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);

  const esAutoservicio = form.modalidad === 'AUTOSERVICIO';
  const esEdredon      = form.modalidad === 'EDREDON';
  const esPorEncargo   = form.modalidad === 'POR_ENCARGO';

  const ajusteNum = Number(form.ajuste) || 0;

  // Autoservicio: precio calculado en tiempo real
  const subtotalCargas    = (Number(form.cantidad_cargas) || 1) * PRECIO_POR_CARGA;
  const subtotalArticulos = articulosAutoLista.reduce((sum, a) => {
    const art = articulosCatalogo.find(x => String(x.id) === String(a.articulo_id));
    return sum + (art ? (Number(art.precio_unitario) || 0) * (Number(a.cantidad) || 0) : 0);
  }, 0);
  const precioAutoservicio = subtotalCargas + ajusteNum + subtotalArticulos;

  // precio_total calculado para EDREDON / POR_ENCARGO
  // precio_base es NULL hasta que se configure desde el sistema
  const precioBaseConfig = null; // placeholder
  const precioCalculado  =
    precioBaseConfig !== null ? precioBaseConfig + ajusteNum : null;

  useEffect(() => {
    Promise.all([api.get('/clientes'), api.get('/maquinas'), api.get('/insumos'), api.get('/articulos')])
      .then(([c, m, i, art]) => {
        setClientes(c);
        setMaquinas(m.filter(maq => maq.estado === 'disponible'));
        setInsumos(i);
        setArticulosCatalogo(art);
      })
      .finally(() => setLoadingData(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => {
      const next = { ...f, [name]: value };
      if (name === 'modalidad') {
        next.cliente_id      = '';
        next.tamano          = '';
        next.ajuste          = '0';
        next.cantidad_cargas = '1';
        next.descripcion     = '';
        next.maquina_id      = '';
        setArticulosAutoLista([]);
      }
      return next;
    });
  };

  const agregarArticuloAuto = () =>
    setArticulosAutoLista(prev => [...prev, { articulo_id: '', cantidad: '1' }]);

  const actualizarArticuloAuto = (i, field, value) =>
    setArticulosAutoLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarArticuloAuto = (i) =>
    setArticulosAutoLista(prev => prev.filter((_, idx) => idx !== i));

  const agregarInsumo  = () =>
    setInsumosLista(prev => [...prev, { insumo_id: '', cantidad: '' }]);

  const actualizarInsumo = (i, field, value) =>
    setInsumosLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarInsumo = (i) =>
    setInsumosLista(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Para Autoservicio, descripcion se construye como "Cargas: N — [texto libre]"
    let descripcionFinal = form.descripcion || undefined;
    if (esAutoservicio) {
      const cargas = Number(form.cantidad_cargas) || 1;
      descripcionFinal = form.descripcion
        ? `Cargas: ${cargas} — ${form.descripcion}`
        : `Cargas: ${cargas}`;
    }

    const payload = {
      modalidad:   form.modalidad,
      estado_pago: esAutoservicio ? 'PAGADO' : form.estado_pago,
      sucursal:    'lopez_cotilla',
      descripcion: descripcionFinal,
      peso_kg:     form.peso_kg ? Number(form.peso_kg) : undefined,
      notas:       form.notas   || undefined,
      maquina_id:  form.maquina_id ? Number(form.maquina_id) : undefined,
    };

    if (esAutoservicio) {
      payload.cantidad_cargas = Number(form.cantidad_cargas) || 1;
      payload.precio_base     = PRECIO_POR_CARGA;
      payload.ajuste          = ajusteNum;
      payload.articulos = articulosAutoLista
        .filter(a => a.articulo_id && a.cantidad)
        .map(a => ({ articulo_id: Number(a.articulo_id), cantidad: Number(a.cantidad) }));
    }

    if (esEdredon || esPorEncargo) {
      payload.ajuste = ajusteNum;
    }

    if (esPorEncargo) {
      payload.cliente_id    = form.cliente_id ? Number(form.cliente_id) : undefined;
      payload.tamano        = form.tamano || undefined;
      payload.fecha_entrega = form.fecha_entrega || undefined;
      payload.insumos       = insumosLista
        .filter(i => i.insumo_id && i.cantidad)
        .map(i => ({ insumo_id: Number(i.insumo_id), cantidad: Number(i.cantidad) }));
    }

    try {
      await api.post('/ordenes', payload);
      navigate('/ordenes');
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
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 mb-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver
        </button>
        <h1 className="text-xl font-bold text-gray-900">Nueva orden</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Tipo de servicio ─────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Tipo de servicio</h2>
          <div className="flex gap-3">
            {TIPOS.map(({ val, label, desc }) => (
              <label
                key={val}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-lg border-2 cursor-pointer transition-colors ${
                  form.modalidad === val
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio" name="modalidad" value={val}
                  checked={form.modalidad === val} onChange={handleChange}
                  className="sr-only"
                />
                <span className={`text-sm font-semibold ${form.modalidad === val ? 'text-indigo-700' : 'text-gray-700'}`}>
                  {label}
                </span>
                <span className="text-xs text-gray-400 text-center leading-tight">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── Datos de la orden ────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Datos de la orden</h2>

          {/* Cliente — solo POR_ENCARGO */}
          {esPorEncargo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Cliente <span className="text-red-500">*</span>
              </label>
              <select
                name="cliente_id" required value={form.cliente_id}
                onChange={handleChange} className={INPUT_CLS}
              >
                <option value="">Seleccionar cliente...</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.telefono ? ` — ${c.telefono}` : ''}
                  </option>
                ))}
              </select>
              {clientes.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No hay clientes registrados.{' '}
                  <a href="/clientes" className="underline">Agregar uno</a>
                </p>
              )}
            </div>
          )}

          {/* Tamaño — solo POR_ENCARGO */}
          {esPorEncargo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Tamaño <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {[
                  { val: 'chico',  label: 'Chico'  },
                  { val: 'grande', label: 'Grande' },
                ].map(({ val, label }) => (
                  <label
                    key={val}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border-2 cursor-pointer transition-colors ${
                      form.tamano === val
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <input
                      type="radio" name="tamano" value={val}
                      checked={form.tamano === val} onChange={handleChange}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Campos específicos de AUTOSERVICIO ─────────── */}
          {esAutoservicio && (
            <>
              {/* 1. Número de orden + 2. ID — solo orientativo */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Número de orden
                  </label>
                  <input
                    type="text" value="Se asignará al guardar" disabled
                    className={INPUT_DISABLED_CLS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    ID
                  </label>
                  <input
                    type="text" value="Se asignará al guardar" disabled
                    className={INPUT_DISABLED_CLS}
                  />
                </div>
              </div>

              {/* 3. Máquina */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Máquina</label>
                <select name="maquina_id" value={form.maquina_id} onChange={handleChange} className={INPUT_CLS}>
                  <option value="">Sin asignar</option>
                  {maquinas.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} — {m.tipo.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                {maquinas.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">No hay máquinas disponibles en este momento.</p>
                )}
              </div>

              {/* 4. Cantidad de cargas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Cantidad de cargas <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-400 mb-1.5">Precio base por carga: $70.00 MXN</p>
                <input
                  type="number" name="cantidad_cargas" min="1" step="1" required
                  value={form.cantidad_cargas} onChange={handleChange}
                  placeholder="1" className={INPUT_CLS}
                />
                <p className="text-xs text-indigo-600 mt-1 font-medium">
                  Subtotal cargas: ${subtotalCargas.toFixed(2)}
                </p>
              </div>

              {/* 5. Ajuste */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Ajuste ($)</label>
                <input
                  type="number" name="ajuste" step="0.01"
                  value={form.ajuste} onChange={handleChange}
                  placeholder="Ej. -10 para descuento, 20 para cargo extra"
                  className={INPUT_CLS}
                />
                <p className="text-xs text-gray-400 mt-1">Descuento (negativo) o cargo extra (positivo)</p>
              </div>

              {/* 6. Descripción */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
                <textarea
                  name="descripcion" value={form.descripcion} onChange={handleChange} rows={2}
                  placeholder="Ej. Ropa de cama, ropa casual..."
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </>
          )}

          {/* Precio base + ajuste + total calculado — EDREDON y POR_ENCARGO */}
          {(esEdredon || esPorEncargo) && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Precio base ($)
                  </label>
                  <input
                    type="text" value="—" disabled
                    className={INPUT_DISABLED_CLS}
                  />
                  <p className="text-xs text-gray-400 mt-1">Pendiente de configuración</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Ajuste ($)
                  </label>
                  <input
                    type="number" name="ajuste" step="0.01"
                    value={form.ajuste} onChange={handleChange}
                    placeholder="0.00" className={INPUT_CLS}
                  />
                  <p className="text-xs text-gray-400 mt-1">Cargo extra o descuento</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Total ($)
                </label>
                <input
                  type="text"
                  value={precioCalculado !== null ? `$${precioCalculado.toFixed(2)}` : '—'}
                  disabled className={INPUT_DISABLED_CLS}
                />
              </div>
            </div>
          )}

          {/* Estado de pago — oculto en Autoservicio (siempre PAGADO) */}
          {!esAutoservicio && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Estado de pago <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              {[
                { val: 'PAGADO', label: 'Pagado' },
                { val: 'DEBE',   label: 'Debe'   },
              ].map(({ val, label }) => (
                <label
                  key={val}
                  className={`flex items-center gap-2 flex-1 py-2.5 px-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    form.estado_pago === val
                      ? val === 'PAGADO'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-red-400 bg-red-50 text-red-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <input
                    type="radio" name="estado_pago" value={val}
                    checked={form.estado_pago === val} onChange={handleChange}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium">{label}</span>
                </label>
              ))}
            </div>
          </div>
          )}

          {/* Fecha de entrega — solo POR_ENCARGO */}
          {esPorEncargo && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha de entrega</label>
              <input
                type="datetime-local" name="fecha_entrega"
                value={form.fecha_entrega} onChange={handleChange}
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Datos operativos — EDREDON y POR_ENCARGO */}
          {!esAutoservicio && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Peso (kg)</label>
                  <input
                    type="number" name="peso_kg" min="0" step="0.1"
                    value={form.peso_kg} onChange={handleChange}
                    placeholder="0.0" className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Máquina</label>
                  <select name="maquina_id" value={form.maquina_id} onChange={handleChange} className={INPUT_CLS}>
                    <option value="">Sin asignar</option>
                    {maquinas.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.nombre} — {m.tipo.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
                <input
                  type="text" name="descripcion" value={form.descripcion}
                  onChange={handleChange} placeholder="Ej. Ropa de cama, ropa casual..."
                  className={INPUT_CLS}
                />
              </div>
            </>
          )}

          {!esAutoservicio && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notas</label>
              <textarea
                name="notas" value={form.notas} onChange={handleChange} rows={2}
                placeholder="Instrucciones especiales..."
                className={`${INPUT_CLS} resize-none`}
              />
            </div>
          )}

        </div>

        {/* ── Artículos — solo AUTOSERVICIO ───────────────── */}
        {esAutoservicio && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Artículos</h2>
              <button
                type="button" onClick={agregarArticuloAuto}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Agregar artículo
              </button>
            </div>

            {articulosAutoLista.length === 0 && (
              <p className="text-xs text-gray-400">
                Sin artículos adicionales.
              </p>
            )}

            {articulosAutoLista.map((item, i) => {
              const art = articulosCatalogo.find(x => String(x.id) === String(item.articulo_id));
              const subtotal = art
                ? (Number(art.precio_unitario) || 0) * (Number(item.cantidad) || 0)
                : 0;
              return (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    value={item.articulo_id}
                    onChange={e => actualizarArticuloAuto(i, 'articulo_id', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Artículo...</option>
                    {articulosCatalogo.map(art => (
                      <option key={art.id} value={art.id}>
                        {art.nombre}{art.precio_unitario ? ` — $${Number(art.precio_unitario).toFixed(2)}` : ''} (stock: {Number(art.stock_disponible ?? art.stock_actual)} {art.unidad})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number" min="1" step="1" placeholder="Cant."
                    value={item.cantidad}
                    onChange={e => actualizarArticuloAuto(i, 'cantidad', e.target.value)}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {subtotal > 0 && (
                    <span className="text-xs text-indigo-600 font-medium w-16 text-right">
                      ${subtotal.toFixed(2)}
                    </span>
                  )}
                  <button
                    type="button" onClick={() => eliminarArticuloAuto(i)}
                    className="text-gray-400 hover:text-red-500 p-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Precio Total — solo AUTOSERVICIO ────────────── */}
        {esAutoservicio && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-2">
              Precio total
            </p>
            <div className="space-y-1 mb-2 text-sm text-indigo-600">
              <div className="flex justify-between">
                <span>Cargas ({form.cantidad_cargas || 1} × $70.00)</span>
                <span>${subtotalCargas.toFixed(2)}</span>
              </div>
              {ajusteNum !== 0 && (
                <div className="flex justify-between">
                  <span>Ajuste</span>
                  <span>{ajusteNum > 0 ? '+' : ''}${ajusteNum.toFixed(2)}</span>
                </div>
              )}
              {subtotalArticulos > 0 && (
                <div className="flex justify-between">
                  <span>Artículos</span>
                  <span>${subtotalArticulos.toFixed(2)}</span>
                </div>
              )}
            </div>
            <p className="text-3xl font-bold text-indigo-700 border-t border-indigo-200 pt-2">
              ${precioAutoservicio.toFixed(2)}
            </p>
          </div>
        )}

        {/* ── Insumos — solo POR_ENCARGO ─────────────────── */}
        {esPorEncargo && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Artículos a descontar</h2>
              <button
                type="button" onClick={agregarInsumo}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Agregar
              </button>
            </div>

            {insumosLista.length === 0 && (
              <p className="text-xs text-gray-400">
                Sin artículos. La orden se creará sin descontar stock.
              </p>
            )}

            {insumosLista.map((item, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={item.insumo_id}
                  onChange={e => actualizarInsumo(i, 'insumo_id', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Artículo...</option>
                  {insumos.map(ins => (
                    <option key={ins.id} value={ins.id}>
                      {ins.nombre} (stock: {ins.stock_actual} {ins.unidad})
                    </option>
                  ))}
                </select>
                <input
                  type="number" min="0.01" step="0.01" placeholder="Cant."
                  value={item.cantidad}
                  onChange={e => actualizarInsumo(i, 'cantidad', e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button" onClick={() => eliminarInsumo(i)}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-4">
          <button
            type="button" onClick={() => navigate(-1)}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={loading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Creando...' : 'Crear orden'}
          </button>
        </div>
      </form>
    </div>
  );
}
