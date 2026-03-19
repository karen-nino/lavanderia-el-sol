import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const INPUT_DISABLED_CLS =
  'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-400 cursor-not-allowed';

const PRECIO_POR_CARGA = 70;

const FORM_INIT = {
  maquina_id:      '',
  cantidad_cargas: '1',
  ajuste:          '0',
  descripcion:     '',
  notas:           '',
};

export default function NuevaOrden() {
  const navigate = useNavigate();
  const [maquinas,          setMaquinas]          = useState([]);
  const [articulosCatalogo, setArticulosCatalogo] = useState([]);
  const [loadingData,       setLoadingData]       = useState(true);
  const [form,              setForm]              = useState(FORM_INIT);
  const [articulosAutoLista, setArticulosAutoLista] = useState([]);
  const [error,             setError]             = useState('');
  const [loading,           setLoading]           = useState(false);

  const ajusteNum      = Number(form.ajuste) || 0;
  const subtotalCargas = (Number(form.cantidad_cargas) || 1) * PRECIO_POR_CARGA;
  const subtotalArticulos = articulosAutoLista.reduce((sum, a) => {
    const art = articulosCatalogo.find(x => String(x.id) === String(a.articulo_id));
    return sum + (art ? (Number(art.precio_unitario) || 0) * (Number(a.cantidad) || 0) : 0);
  }, 0);
  const precioTotal = subtotalCargas + ajusteNum + subtotalArticulos;

  useEffect(() => {
    Promise.all([api.get('/maquinas'), api.get('/articulos')])
      .then(([m, art]) => {
        setMaquinas(m.filter(maq => maq.estado === 'disponible'));
        setArticulosCatalogo(art);
      })
      .finally(() => setLoadingData(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const agregarArticulo = () =>
    setArticulosAutoLista(prev => [...prev, { articulo_id: '', cantidad: '1' }]);

  const actualizarArticulo = (i, field, value) =>
    setArticulosAutoLista(prev =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    );

  const eliminarArticulo = (i) =>
    setArticulosAutoLista(prev => prev.filter((_, idx) => idx !== i));

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
      precio_base:     PRECIO_POR_CARGA,
      ajuste:          ajusteNum,
      articulos:       articulosAutoLista
        .filter(a => a.articulo_id && a.cantidad)
        .map(a => ({ articulo_id: Number(a.articulo_id), cantidad: Number(a.cantidad) })),
    };

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

        {/* ── Datos de la orden ────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Autoservicio</h2>

          {/* Número de orden + ID — orientativo */}
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

          {/* Notas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notas</label>
            <textarea
              name="notas" value={form.notas} onChange={handleChange} rows={2}
              placeholder="Instrucciones especiales..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        {/* ── Artículos ────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Artículos</h2>
            <button
              type="button" onClick={agregarArticulo}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Agregar artículo
            </button>
          </div>

          {articulosAutoLista.length === 0 && (
            <p className="text-xs text-gray-400">Sin artículos adicionales.</p>
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
                  onChange={e => actualizarArticulo(i, 'articulo_id', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Artículo...</option>
                  {articulosCatalogo.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}{a.precio_unitario ? ` — $${Number(a.precio_unitario).toFixed(2)}` : ''} (stock: {Number(a.stock_disponible ?? a.stock_actual)} {a.unidad})
                    </option>
                  ))}
                </select>
                <input
                  type="number" min="1" step="1" placeholder="Cant."
                  value={item.cantidad}
                  onChange={e => actualizarArticulo(i, 'cantidad', e.target.value)}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {subtotal > 0 && (
                  <span className="text-xs text-indigo-600 font-medium w-16 text-right">
                    ${subtotal.toFixed(2)}
                  </span>
                )}
                <button
                  type="button" onClick={() => eliminarArticulo(i)}
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
            {loading ? 'Creando...' : 'Crear orden'}
          </button>
        </div>
      </form>
    </div>
  );
}
