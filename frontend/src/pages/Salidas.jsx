import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

export default function Salidas() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [orden,           setOrden]           = useState(null);
  const [articulos,       setArticulos]       = useState([]);
  const [cantidades,      setCantidades]      = useState({});
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [loadingMaquina,  setLoadingMaquina]  = useState(false);
  const [loadingArticulo, setLoadingArticulo] = useState(null); // id del artículo en proceso
  const [errorAccion,     setErrorAccion]     = useState('');

  useEffect(() => { cargarDatos(); }, [id]);

  async function cargarDatos() {
    setLoading(true);
    setError('');
    try {
      const [ordenData, articulosData] = await Promise.all([
        api.get(`/ordenes/${id}`),
        api.get('/articulos'),
      ]);
      setOrden(ordenData);
      setArticulos(articulosData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function activarMaquina() {
    if (!orden?.maquina_id) return;
    setLoadingMaquina(true);
    setErrorAccion('');
    try {
      await api.patch(`/maquinas/${orden.maquina_id}/estado`, { estado: 'en_uso' });
      await api.patch(`/ordenes/${id}/estado`, { estado: 'EN_PROCESO' });
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingMaquina(false);
    }
  }

  async function agregarArticulo(articuloId) {
    const cantidad = Number(cantidades[articuloId]);
    if (!cantidad || cantidad <= 0) return;
    setLoadingArticulo(articuloId);
    setErrorAccion('');
    try {
      await api.post(`/ordenes/${id}/articulos`, { articulo_id: articuloId, cantidad });
      setCantidades(prev => ({ ...prev, [articuloId]: '' }));
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingArticulo(null);
    }
  }

  async function eliminarArticulo(articuloId) {
    setLoadingArticulo(articuloId);
    setErrorAccion('');
    try {
      await api.delete(`/ordenes/${id}/articulos/${articuloId}`);
      await cargarDatos();
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setLoadingArticulo(null);
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

  const maquina        = orden?.maquina_nombre;
  const maquinaEnUso   = orden?.maquina_estado === 'en_uso';
  const articulosOrden = orden?.articulos || [];
  const articulosIdsEnOrden = new Set(articulosOrden.map(a => a.articulo_id));

  // Solo artículos disponibles (stock_disponible > 0) que no estén ya en la orden
  const articulosDisponibles = articulos.filter(
    a => Number(a.stock_disponible) > 0 && !articulosIdsEnOrden.has(a.id)
  );

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">

      {/* Cabecera */}
      <div>
        <button
          onClick={() => navigate(`/ordenes/${id}`)}
          className="text-sm text-indigo-600 hover:underline mb-1 flex items-center gap-1"
        >
          ← Detalle de orden
        </button>
        <h1 className="text-xl font-bold text-gray-900">Salidas</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {orden?.folio ?? `Orden #${id}`}
        </p>
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
            {orden?.maquina_estado && (
              <span className={`mt-1 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                orden.maquina_estado === 'en_uso'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {orden.maquina_estado === 'en_uso' ? 'En uso' : orden.maquina_estado}
              </span>
            )}
          </div>
          {orden?.maquina_id && (
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

      {/* Sección 2 — Artículos en la orden */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Artículos en esta orden</h2>
          <button
            onClick={cargarDatos}
            className="text-xs text-indigo-600 hover:underline"
          >
            Actualizar
          </button>
        </div>
        {articulosOrden.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">Sin artículos agregados</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {articulosOrden.map(a => (
              <div key={a.articulo_id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{a.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Cant. {a.cantidad} × {fmtMonto(a.precio_unitario)} = {fmtMonto(a.subtotal)}
                  </p>
                </div>
                <button
                  onClick={() => eliminarArticulo(a.articulo_id)}
                  disabled={loadingArticulo === a.articulo_id}
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
              <span className="text-sm font-bold text-gray-900">{fmtMonto(orden?.precio_total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Sección 3 — Agregar artículos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Agregar artículos</h2>
          <p className="text-xs text-gray-400 mt-0.5">Solo artículos con stock disponible</p>
        </div>
        {articulosDisponibles.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400 italic">
            {articulos.length === 0
              ? 'No hay artículos registrados'
              : 'Sin stock disponible o todos ya están en la orden'}
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {articulosDisponibles.map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.nombre}</p>
                  <p className="text-xs text-gray-400">
                    Disponible: {a.stock_disponible} {a.unidad} · {fmtMonto(a.precio_unitario)}
                  </p>
                </div>
                <input
                  type="number"
                  min="1"
                  max={a.stock_disponible}
                  value={cantidades[a.id] ?? ''}
                  onChange={e => setCantidades(prev => ({ ...prev, [a.id]: e.target.value }))}
                  placeholder="Cant."
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={() => agregarArticulo(a.id)}
                  disabled={!cantidades[a.id] || loadingArticulo === a.id}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                >
                  {loadingArticulo === a.id ? '...' : 'Agregar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
