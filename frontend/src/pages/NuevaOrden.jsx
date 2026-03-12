import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const FORM_INIT = {
  modalidad: 'POR_ENCARGO',
  cliente_id: '',
  maquina_id: '',
  descripcion: '',
  peso_kg: '',
  precio_total: '',
  estado_pago: 'contado',
  fecha_entrega: '',
  notas: '',
};

export default function NuevaOrden() {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState([]);
  const [maquinas, setMaquinas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [form, setForm] = useState(FORM_INIT);
  const [insumosLista, setInsumosLista] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const esAutoservicio = form.modalidad === 'AUTOSERVICIO';

  useEffect(() => {
    Promise.all([api.get('/clientes'), api.get('/maquinas'), api.get('/insumos')])
      .then(([c, m, i]) => {
        setClientes(c);
        setMaquinas(m.filter(maq => maq.estado === 'disponible'));
        setInsumos(i);
      })
      .finally(() => setLoadingData(false));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => {
      const next = { ...f, [name]: value };
      // Si cambia a autoservicio, limpia el cliente seleccionado
      if (name === 'modalidad' && value === 'AUTOSERVICIO') {
        next.cliente_id = '';
      }
      return next;
    });
  };

  const agregarInsumo = () =>
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
    const payload = {
      modalidad: form.modalidad,
      estado_pago: form.estado_pago,
      cliente_id: form.cliente_id ? Number(form.cliente_id) : undefined,
      maquina_id: form.maquina_id ? Number(form.maquina_id) : undefined,
      descripcion: form.descripcion || undefined,
      peso_kg: form.peso_kg ? Number(form.peso_kg) : undefined,
      precio_total: form.precio_total ? Number(form.precio_total) : undefined,
      fecha_entrega: form.fecha_entrega || undefined,
      notas: form.notas || undefined,
      insumos: insumosLista
        .filter(i => i.insumo_id && i.cantidad)
        .map(i => ({ insumo_id: Number(i.insumo_id), cantidad: Number(i.cantidad) })),
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
        {/* Modalidad */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Tipo de servicio</h2>

          <div className="flex gap-3">
            {[
              { val: 'POR_ENCARGO', label: 'Por encargo', desc: 'Cliente identificado' },
              { val: 'AUTOSERVICIO', label: 'Autoservicio', desc: 'Cliente anónimo' },
            ].map(({ val, label, desc }) => (
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
                <span className="text-xs text-gray-400">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Datos principales */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Datos de la orden</h2>

          {/* Cliente — solo en POR_ENCARGO */}
          {!esAutoservicio && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Cliente <span className="text-red-500">*</span>
              </label>
              <select name="cliente_id" required={!esAutoservicio} value={form.cliente_id} onChange={handleChange} className={INPUT_CLS}>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Máquina</label>
            <select name="maquina_id" value={form.maquina_id} onChange={handleChange} className={INPUT_CLS}>
              <option value="">Sin asignar</option>
              {maquinas.map(m => (
                <option key={m.id} value={m.id}>{m.nombre} ({m.tipo.replace('_', ' ')})</option>
              ))}
            </select>
            {maquinas.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No hay máquinas disponibles en este momento.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción</label>
            <input
              type="text" name="descripcion" value={form.descripcion} onChange={handleChange}
              placeholder="Ej. Ropa de cama, ropa casual..."
              className={INPUT_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Peso (kg)</label>
              <input
                type="number" name="peso_kg" min="0" step="0.1" value={form.peso_kg}
                onChange={handleChange} placeholder="0.0" className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Precio ($)</label>
              <input
                type="number" name="precio_total" min="0" step="0.01" value={form.precio_total}
                onChange={handleChange} placeholder="0.00" className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Estado de pago</label>
            <div className="flex gap-3">
              {[
                { val: 'contado', label: 'Pagado' },
                { val: 'debe', label: 'Debe' },
              ].map(({ val, label }) => (
                <label
                  key={val}
                  className={`flex items-center gap-2 flex-1 py-2.5 px-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    form.estado_pago === val
                      ? val === 'contado'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-amber-500 bg-amber-50 text-amber-700'
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

          {!esAutoservicio && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha de entrega</label>
              <input type="datetime-local" name="fecha_entrega" value={form.fecha_entrega} onChange={handleChange} className={INPUT_CLS} />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notas</label>
            <textarea
              name="notas" value={form.notas} onChange={handleChange} rows={2}
              placeholder="Instrucciones especiales..."
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
        </div>

        {/* Insumos — solo en POR_ENCARGO */}
        {!esAutoservicio && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Insumos a descontar</h2>
              <button
                type="button" onClick={agregarInsumo}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Agregar
              </button>
            </div>

            {insumosLista.length === 0 && (
              <p className="text-xs text-gray-400">
                Sin insumos. La orden se creará sin descontar stock.
              </p>
            )}

            {insumosLista.map((item, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={item.insumo_id}
                  onChange={e => actualizarInsumo(i, 'insumo_id', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Insumo...</option>
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
