import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const INPUT_DISABLED_CLS =
  'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed';

const FORM_INIT = {
  maquina_id:      '',
  cantidad_cargas: '1',
  ajuste:          '0',
  descripcion:     '',
  notas:           '',
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
    setError('');
    setLoading(true);

    const cargas = Number(form.cantidad_cargas) || 1;
    const descripcionFinal = form.descripcion
      ? `Cargas: ${cargas} — ${form.descripcion}`
      : `Cargas: ${cargas}`;

    const payload = {
      modalidad:       'AUTOSERVICIO',
      estado_pago:     'PAGADO',
      sucursal:        'lopez_cotilla',
      descripcion:     descripcionFinal,
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

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Datos de la nota ────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Autoservicio</h2>

          {/* Número de nota + ID — orientativo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Número de nota
              </label>
              <input
                type="text" value="Se asignará al guardar" disabled
                className={INPUT_DISABLED_CLS}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">ID</label>
              <input
                type="text" value="Se asignará al guardar" disabled
                className={INPUT_DISABLED_CLS}
              />
            </div>
          </div>

          {/* Máquina */}
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

          {/* Cantidad de cargas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Cantidad de cargas <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-1.5">Precio base por carga: ${precioCarga.toFixed(2)} MXN</p>
            <input
              type="number" name="cantidad_cargas" min="1" step="1" required
              value={form.cantidad_cargas} onChange={handleChange}
              placeholder="1" className={INPUT_CLS}
            />
            <p className="text-xs text-indigo-600 mt-1 font-medium">
              Subtotal cargas: ${subtotalCargas.toFixed(2)}
            </p>
          </div>

          {/* Ajuste */}
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

          {/* Descripción */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <textarea
              name="descripcion" value={form.descripcion} onChange={handleChange} rows={2}
              placeholder="Ej. Ropa de cama, ropa casual..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>

          {/* Observaciones */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Observaciones</label>
            <textarea
              name="notas" value={form.notas} onChange={handleChange} rows={2}
              placeholder="Instrucciones especiales..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        {/* ── Productos ────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Productos</h2>
            <button
              type="button" onClick={agregarProducto}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Agregar producto
            </button>
          </div>

          {productosLista.length === 0 && (
            <p className="text-xs text-gray-400">Sin productos adicionales.</p>
          )}

          {productosLista.map((item, i) => {
            const prod = productosCatalogo.find(x => String(x.id) === String(item.producto_id));
            const subtotal = prod
              ? (Number(prod.precio_unitario) || 0) * (Number(item.cantidad) || 0)
              : 0;
            return (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={item.producto_id}
                  onChange={e => actualizarProducto(i, 'producto_id', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Producto...</option>
                  {productosCatalogo.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}{p.precio_unitario ? ` — $${Number(p.precio_unitario).toFixed(2)}` : ''} (stock: {Number(p.stock_disponible ?? p.stock_actual)} {p.unidad})
                    </option>
                  ))}
                </select>
                <input
                  type="number" min="1" step="1" placeholder="Cant."
                  value={item.cantidad}
                  onChange={e => actualizarProducto(i, 'cantidad', e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {subtotal > 0 && (
                  <span className="text-xs text-indigo-600 font-medium w-16 text-right">
                    ${subtotal.toFixed(2)}
                  </span>
                )}
                <button
                  type="button" onClick={() => eliminarProducto(i)}
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
            {loading ? 'Creando...' : 'Crear nota'}
          </button>
        </div>
      </form>
    </div>
  );
}
