import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const INPUT_CLS =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

const CATEGORIAS = ['Detergente', 'Suavizante', 'Blanqueador', 'Bolsas', 'Otro'];
const UNIDADES   = ['Litros', 'Kilos', 'Piezas', 'Mililitros'];

const FORM_VACIO = {
  nombre:          '',
  categoria:       '',
  precio_unitario: '',
  unidad:          '',
  stock_actual:    '0',
};

// ── Modal crear / editar ────────────────────────────────────────
function ModalProducto({ producto, onClose, onGuardado }) {
  const [form, setForm]     = useState(producto
    ? {
        nombre:          producto.nombre,
        categoria:       producto.categoria ?? '',
        precio_unitario: producto.precio_unitario ?? '',
        unidad:          producto.unidad,
        stock_actual:    producto.stock_actual,
      }
    : FORM_VACIO
  );
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const esEdicion = Boolean(producto);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const body = {
      nombre:          form.nombre.trim(),
      categoria:       form.categoria || null,
      unidad:          form.unidad,
      stock_actual:    Number(form.stock_actual),
      precio_unitario: form.precio_unitario !== '' ? Number(form.precio_unitario) : null,
    };

    try {
      let resultado;
      if (esEdicion) {
        resultado = await api.put(`/productos/${producto.id}`, body);
      } else {
        resultado = await api.post('/productos', body);
      }
      onGuardado(resultado, esEdicion);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {esEdicion ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text" name="nombre" required
              value={form.nombre} onChange={handleChange}
              placeholder="Ej. Detergente líquido" className={INPUT_CLS}
            />
          </div>

          {/* Categoría */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Categoría <span className="text-red-500">*</span>
            </label>
            <select name="categoria" required value={form.categoria} onChange={handleChange} className={INPUT_CLS}>
              <option value="">Seleccionar...</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Precio unitario */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Precio unitario ($) <span className="text-red-500">*</span>
            </label>
            <input
              type="number" name="precio_unitario" min="0" step="0.01" required
              value={form.precio_unitario} onChange={handleChange}
              placeholder="0.00" className={INPUT_CLS}
            />
          </div>

          {/* Unidad */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Unidad <span className="text-red-500">*</span>
            </label>
            <select name="unidad" required value={form.unidad} onChange={handleChange} className={INPUT_CLS}>
              <option value="">Seleccionar...</option>
              {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* Stock actual */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Stock actual <span className="text-red-500">*</span>
            </label>
            <input
              type="number" name="stock_actual" min="0" step="0.01" required
              value={form.stock_actual} onChange={handleChange}
              className={INPUT_CLS}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal confirmar eliminación ─────────────────────────────────
function ModalEliminar({ producto, onClose, onConfirmar }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleEliminar = async () => {
    setLoading(true);
    setError('');
    try {
      await onConfirmar();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Eliminar producto</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              ¿Eliminar <span className="font-medium text-gray-700">{producto.nombre}</span>? Esta acción no se puede deshacer.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleEliminar} disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Íconos ─────────────────────────────────────────────────────
function IconoLapiz() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function IconoBasura() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

// ── Página principal ────────────────────────────────────────────
export default function Inventario() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [productos,       setProductos]       = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [modalProducto,   setModalProducto]   = useState(null);  // null | 'nuevo' | producto
  const [prodAEliminar,   setProdAEliminar]   = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/productos')
      .then(setProductos)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, []);

  const stockBajo = productos.filter(p => p.estado_stock !== 'ok');

  const handleGuardado = (resultado, esEdicion) => {
    if (esEdicion) {
      setProductos(prev => prev.map(p => p.id === resultado.id ? resultado : p));
    } else {
      setProductos(prev => [...prev, resultado].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    }
    setModalProducto(null);
  };

  const handleEliminar = async () => {
    await api.delete(`/productos/${prodAEliminar.id}`);
    setProductos(prev => prev.filter(p => p.id !== prodAEliminar.id));
    setProdAEliminar(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500">{productos.length} producto(s) en inventario</p>
        </div>
        <button
          onClick={() => setModalProducto('nuevo')}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Agregar producto
        </button>
      </div>

      {/* Alerta stock bajo */}
      {stockBajo.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-semibold text-amber-800">
              Stock bajo en {stockBajo.length} producto(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stockBajo.map(p => (
              <span key={p.id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                {p.nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {!loading && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {productos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm mb-3">Sin productos en inventario</p>
              <button
                onClick={() => setModalProducto('nuevo')}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Agregar el primero
              </button>
            </div>
          ) : (
            <>
              {/* Tabla — desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Producto</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Categoría</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Precio unit.</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Stock actual</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Unidad</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {productos.map(p => {
                      const es = p.estado_stock ?? 'ok';
                      const rowCls = es === 'agotado' ? 'bg-red-50/40' : es === 'por_agotarse' ? 'bg-amber-50/40' : '';
                      return (
                        <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${rowCls}`}>
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-800">{p.nombre}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {p.categoria ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {p.precio_unitario != null ? `$${Number(p.precio_unitario).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="font-mono font-semibold text-sm text-gray-800">
                                {Number(p.stock_actual).toFixed(2)}
                              </span>
                              {es === 'agotado' && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>
                              )}
                              {es === 'por_agotarse' && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>
                              )}
                              {es === 'ok' && (
                                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{p.unidad}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setModalProducto(p)}
                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Editar"
                              >
                                <IconoLapiz />
                              </button>
                              {esAdmin && (
                                <button
                                  onClick={() => setProdAEliminar(p)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Eliminar"
                                >
                                  <IconoBasura />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cards — mobile */}
              <div className="md:hidden divide-y divide-gray-50">
                {productos.map(p => {
                  const es = p.estado_stock ?? 'ok';
                  const rowCls = es === 'agotado' ? 'bg-red-50/40' : es === 'por_agotarse' ? 'bg-amber-50/40' : '';
                  return (
                    <div key={p.id} className={`px-4 py-3 ${rowCls}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800 text-sm">{p.nombre}</p>
                          {p.categoria && (
                            <p className="text-xs text-gray-400 mt-0.5">{p.categoria}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-sm font-mono font-semibold text-gray-700">
                              {Number(p.stock_actual).toFixed(2)} {p.unidad}
                            </span>
                            {es === 'agotado' && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>
                            )}
                            {es === 'por_agotarse' && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>
                            )}
                            {p.precio_unitario != null && (
                              <span className="text-xs text-gray-500">
                                ${Number(p.precio_unitario).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setModalProducto(p)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          >
                            <IconoLapiz />
                          </button>
                          {esAdmin && (
                            <button
                              onClick={() => setProdAEliminar(p)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <IconoBasura />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal crear / editar */}
      {modalProducto && (
        <ModalProducto
          producto={modalProducto === 'nuevo' ? null : modalProducto}
          onClose={() => setModalProducto(null)}
          onGuardado={handleGuardado}
        />
      )}

      {/* Modal confirmar eliminar */}
      {prodAEliminar && (
        <ModalEliminar
          producto={prodAEliminar}
          onClose={() => setProdAEliminar(null)}
          onConfirmar={handleEliminar}
        />
      )}
    </div>
  );
}
