import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

export default function Salidas() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [nota,            setNota]            = useState(null);
  const [productos,        setProductos]        = useState([]);
  const [cantidades,       setCantidades]       = useState({});
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [loadingMaquina,   setLoadingMaquina]   = useState(false);
  const [loadingProducto,  setLoadingProducto]  = useState(null); // id del producto en proceso
  const [errorAccion,      setErrorAccion]      = useState('');

  useEffect(() => { cargarDatos(); }, [id]);

  async function cargarDatos() {
    setLoading(true);
    setError('');
    try {
      const [notaData, productosData] = await Promise.all([
        api.get(`/notas/${id}`),
        api.get('/productos'),
      ]);
      setNota(notaData);
      setProductos(productosData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function activarMaquina() {
    if (!nota?.maquina_id) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/maquinas/${nota.maquina_id}/estado`, { estado: 'en_uso' });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  async function agregarProducto(productoId) {
    const cantidad = Number(cantidades[productoId]);
    if (!cantidad || cantidad <= 0) return;
    setLoadingProducto(productoId);
    setErrorAccion('');
    try {
      await api.post(`/notas/${id}/productos`, { producto_id: productoId, cantidad });
      setCantidades(prev => ({ ...prev, [productoId]: '' }));
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
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

  const maquina         = nota?.maquina_nombre;
  const maquinaEnUso    = nota?.maquina_estado === 'en_uso';
  const productosNota  = nota?.productos || [];
  const productosIdsEnNota = new Set(productosNota.map(p => p.producto_id));

  // Solo productos disponibles (stock_disponible > 0) que no estén ya en la nota
  const productosDisponibles = productos.filter(
    p => Number(p.stock_disponible) > 0 && !productosIdsEnNota.has(p.id)
  );

  return (
    <div className="pt-10 pb-16 px-6 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/notas/${id}`)}
          aria-label="Volver"
          className="flex-shrink-0 w-12 h-12 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition-colors"
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

      {/* Sección 1 — Máquina */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Máquina asignada</h2>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div>
            {maquina
              ? <p className="text-sm font-medium text-gray-800">{maquina}</p>
              : <p className="text-sm text-gray-400 italic">Sin máquina asignada</p>}
            {nota?.maquina_estado && (
              <span className={`mt-1 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                nota.maquina_estado === 'en_uso'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {nota.maquina_estado === 'en_uso' ? 'En uso' : nota.maquina_estado}
              </span>
            )}
          </div>
          {nota?.maquina_id && (
            maquinaEnUso ? (
              <span className="text-xs font-semibold px-3 py-2 bg-blue-100 text-blue-700 rounded-lg">
                Máquina activa
              </span>
            ) : (
              <button
                onClick={activarMaquina}
                disabled={loadingMaquina}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loadingMaquina ? 'Activando...' : 'Activar máquina'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Sección 2 — Productos en la nota */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Productos en esta nota</h2>
          <button
            onClick={cargarDatos}
            className="text-xs text-indigo-600 hover:underline"
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
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Cant. {p.cantidad} × {fmtMonto(p.precio_unitario)} = {fmtMonto(p.subtotal)}
                  </p>
                </div>
                <button
                  onClick={() => eliminarProducto(p.producto_id)}
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
            <div className="px-4 py-3 bg-gray-50 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-sm font-bold text-gray-900">{fmtMonto(nota?.precio_total)}</span>
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
              : 'Sin stock disponible o todos ya están en la nota'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {productosDisponibles.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Disponible: {p.stock_disponible} {p.unidad} · {fmtMonto(p.precio_unitario)}
                  </p>
                </div>
                <input
                  type="number"
                  min="1"
                  max={p.stock_disponible}
                  value={cantidades[p.id] ?? ''}
                  onChange={e => setCantidades(prev => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="Cant."
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={() => agregarProducto(p.id)}
                  disabled={!cantidades[p.id] || loadingProducto === p.id}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                >
                  {loadingProducto === p.id ? '...' : 'Agregar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
