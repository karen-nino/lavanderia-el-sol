import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';

const CATEGORIAS = ['Detergente', 'Suavizante', 'Blanqueador', 'Bolsas', 'Otro'];
const ENVASES    = ['Cubeta', 'Caja', 'Garrafa', 'Botella'];

function pluralizarUnidad(cantidad, unidad) {
  const n = Math.round(Number(cantidad));
  const u = unidad ?? '';
  if (n === 1 && u.toLowerCase().endsWith('s')) {
    return u.slice(0, -1);
  }
  return u;
}

function pluralizarEnvase(n, envase) {
  const e = envase || 'envase';
  return n === 1 ? e : `${e}s`;
}

// Cantidad de stock legible. Productos por tapa/medida se muestran en tapas con
// una equivalencia en envases (ej. "62 tapas ≈ 3 cubetas"); los demás en piezas.
function formatoStock(p) {
  const n = Math.round(Number(p.stock_actual));
  if (p.es_por_tapa) {
    const porEnv  = Number(p.tapas_por_envase) || 0;
    const envases = porEnv > 0 ? Math.floor(n / porEnv) : 0;
    return {
      cantidad:     `${n} ${n === 1 ? 'tapa' : 'tapas'}`,
      equivalencia: envases > 0 ? `≈ ${envases} ${pluralizarEnvase(envases, (p.envase || '').toLowerCase())}` : '',
    };
  }
  return { cantidad: `${n} ${n === 1 ? 'Pieza' : 'Piezas'}`, equivalencia: '' };
}

const UNIDADES_VOLUMEN = ['Litros', 'Mililitros'];

// Convierte un valor a mililitros según su unidad.
function aMl(valor, unidad) {
  const v = Number(valor) || 0;
  return unidad === 'Litros' ? v * 1000 : v;
}

const FORM_VACIO = {
  nombre:              '',
  categoria:           '',
  precio_unitario:     '',
  unidad:              '',
  stock_actual:        '0',
  es_por_tapa:         false,
  envase:              '',
  tapas_por_envase:    '',
  stock_minimo:        '0',
  metodo_rendimiento:  'volumen',   // 'volumen' (litros + mL) | 'tapas' (directo)
  volumen_envase:      '',
  unidad_volumen:      'Litros',
  tapa_ml:             '',
};

// ── Modal crear / editar ────────────────────────────────────────
function ModalProducto({ producto, esAdmin, onClose, onGuardado }) {
  const [form, setForm]     = useState(producto
    ? {
        nombre:              producto.nombre,
        categoria:           producto.categoria ?? '',
        precio_unitario:     producto.precio_unitario ?? '',
        unidad:              producto.unidad,
        stock_actual:        producto.stock_actual,
        es_por_tapa:         !!producto.es_por_tapa,
        envase:              producto.envase ?? '',
        tapas_por_envase:    producto.tapas_por_envase ?? '',
        stock_minimo:        producto.stock_minimo ?? '0',
        metodo_rendimiento:  producto.volumen_envase_ml ? 'volumen' : (producto.es_por_tapa ? 'tapas' : 'volumen'),
        volumen_envase:      producto.volumen_envase_ml
          ? (producto.volumen_envase_ml % 1000 === 0 ? String(producto.volumen_envase_ml / 1000) : String(producto.volumen_envase_ml))
          : '',
        unidad_volumen:      producto.volumen_envase_ml && producto.volumen_envase_ml % 1000 !== 0 ? 'Mililitros' : 'Litros',
        tapa_ml:             producto.tapa_ml ?? '',
      }
    : FORM_VACIO
  );
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const esEdicion = Boolean(producto);
  // Un empleado (no admin) editando solo puede ver y ajustar el stock.
  const soloStock = esEdicion && !esAdmin;

  // Rendimiento en tapas calculado por volumen (para mostrarlo en vivo).
  const tapaMlNum   = Number(form.tapa_ml) || 0;
  const volMlNum    = aMl(form.volumen_envase, form.unidad_volumen);
  const tapasPorVol = tapaMlNum > 0 ? Math.floor(volMlNum / tapaMlNum) : 0;
  // Tapas por envase efectivas: calculadas por volumen o escritas directo.
  const tapasEfectivas = form.metodo_rendimiento === 'volumen' ? tapasPorVol : (Number(form.tapas_por_envase) || 0);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Todos los productos se consumen por tapa/medida.
    const porVolumen = form.metodo_rendimiento === 'volumen';
    const tapaMlVal  = Number(form.tapa_ml) || 0;
    const volMl      = aMl(form.volumen_envase, form.unidad_volumen);
    // Las tapas del rendimiento: calculadas por volumen o escritas directo.
    const tapas = porVolumen
      ? (tapaMlVal > 0 ? Math.floor(volMl / tapaMlVal) : 0)
      : (Number(form.tapas_por_envase) || 0);

    const body = {
      nombre:            form.nombre.trim(),
      categoria:         form.categoria || null,
      unidad:            'Tapas',
      stock_actual:      Number(form.stock_actual),
      precio_unitario:   form.precio_unitario !== '' ? Number(form.precio_unitario) : null,
      es_por_tapa:       true,
      tapas_por_envase:  tapas > 0 ? tapas : null,
      envase:            form.envase || null,
      stock_minimo:      Number(form.stock_minimo) || 0,
      volumen_envase_ml: porVolumen && volMl > 0 ? volMl : null,
      tapa_ml:           porVolumen && tapaMlVal > 0 ? tapaMlVal : null,
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            {esEdicion ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {!soloStock && (
          <>
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

          {/* Precio por tapa */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Precio por tapa ($) <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" name="precio_unitario" min="0" step="10" required
                  value={form.precio_unitario} onChange={handleChange}
                  placeholder="0.00"
                  className={`${INPUT_CLS} pl-8 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                />
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, precio_unitario: String(Math.max(0, (Number(f.precio_unitario) || 0) - 10)) }))}
                disabled={(Number(form.precio_unitario) || 0) <= 0}
                aria-label="Disminuir precio"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, precio_unitario: String((Number(f.precio_unitario) || 0) + 10) }))}
                aria-label="Aumentar precio"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                +
              </button>
            </div>
          </div>

              {/* Envase */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Envase <span className="text-red-500">*</span>
                </label>
                <select name="envase" required value={form.envase} onChange={handleChange} className={INPUT_CLS}>
                  <option value="">Seleccionar...</option>
                  {ENVASES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>

              {/* Rendimiento: por volumen (exacto) o tapas directo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Rendimiento del envase <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, metodo_rendimiento: 'volumen' }))}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      form.metodo_rendimiento === 'volumen'
                        ? 'border-blue bg-light-blue text-blue'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Por volumen
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, metodo_rendimiento: 'tapas' }))}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      form.metodo_rendimiento === 'tapas'
                        ? 'border-blue bg-light-blue text-blue'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Solo tapas
                  </button>
                </div>

                {form.metodo_rendimiento === 'volumen' ? (
                  <div className="space-y-3">
                    {/* Contenido del envase */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">¿Cuánto trae el envase?</p>
                      <div className="flex gap-2">
                        <input
                          type="number" name="volumen_envase" min="0" step="any" required
                          value={form.volumen_envase} onChange={handleChange}
                          placeholder="Ej. 15"
                          className={`${INPUT_CLS} flex-1 min-w-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                        />
                        <select
                          name="unidad_volumen" value={form.unidad_volumen} onChange={handleChange}
                          className="w-28 flex-shrink-0 px-3 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
                        >
                          {UNIDADES_VOLUMEN.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* Tamaño de la tapa */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">¿De qué tamaño es la tapa/medida? (mL)</p>
                      <input
                        type="number" name="tapa_ml" min="1" step="any" required
                        value={form.tapa_ml} onChange={handleChange}
                        placeholder="Ej. 100"
                        className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                      />
                    </div>
                    {/* Resultado calculado */}
                    <div className={`rounded-lg px-4 py-3 text-sm ${tapasPorVol > 0 ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
                      {tapasPorVol > 0
                        ? <>Rinde <span className="font-bold">{tapasPorVol} tapas</span> por {(form.envase || 'envase').toLowerCase()}.</>
                        : 'Captura el contenido y el tamaño de la tapa para calcular las tapas.'}
                    </div>
                  </div>
                ) : (
                  <input
                    type="number" name="tapas_por_envase" min="1" step="1" required
                    value={form.tapas_por_envase} onChange={handleChange}
                    placeholder="Ej. 150 tapas por envase"
                    className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  />
                )}
              </div>
          </>
          )}

          {/* Stock actual */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Stock actual (tapas) <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" name="stock_actual" min="0" step="1" required
                value={form.stock_actual} onChange={handleChange}
                className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
              />
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, stock_actual: String(Math.max(0, (Number(f.stock_actual) || 0) - 1)) }))}
                disabled={(Number(form.stock_actual) || 0) <= 0}
                aria-label="Disminuir stock"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, stock_actual: String((Number(f.stock_actual) || 0) + 1) }))}
                aria-label="Aumentar stock"
                className="flex-shrink-0 w-14 py-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-xl font-semibold hover:bg-gray-50 transition-colors"
              >
                +
              </button>
            </div>
            {tapasEfectivas > 0 && (
              <button
                type="button"
                onClick={() => setForm(f => ({
                  ...f,
                  stock_actual: String((Number(f.stock_actual) || 0) + tapasEfectivas),
                }))}
                className="mt-2 w-full py-2.5 rounded-lg border border-blue/40 bg-blue/5 text-blue text-sm font-medium hover:bg-blue/10 transition-colors"
              >
                + Agregar 1 envase ({tapasEfectivas} tapas)
              </button>
            )}
          </div>

          {/* Alerta de stock bajo */}
          {!soloStock && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Avisar cuando queden (tapas)
              </label>
              <input
                type="number" name="stock_minimo" min="0" step="1"
                value={form.stock_minimo} onChange={handleChange}
                placeholder="Ej. 20"
                className={`${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
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
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleEliminar} disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal confirmar archivar ────────────────────────────────────
function ModalArchivar({ producto, onClose, onConfirmar }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleArchivar = async () => {
    setError('');
    setLoading(true);
    try {
      await onConfirmar();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Archivar producto</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-medium text-gray-700">{producto.nombre}</span> se ocultará del inventario y de Nueva Nota.
              Las notas anteriores no se ven afectadas y puedes restaurarlo cuando quieras.
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
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleArchivar} disabled={loading}
            className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading ? 'Archivando...' : 'Archivar'}
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

function IconoArchivar() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}

function IconoAdvertencia({ severity }) {
  const cls = severity === 'agotado' ? 'text-red-600' : 'text-amber-500';
  return (
    <svg className={`w-4 h-4 flex-shrink-0 ${cls}`} fill="currentColor" viewBox="0 0 24 24" aria-label={severity === 'agotado' ? 'Agotado' : 'Stock bajo'}>
      <path d="M12 2L1 21h22L12 2zm0 6l7.53 13H4.47L12 8zm-1 3v5h2v-5h-2zm0 6v2h2v-2h-2z" />
    </svg>
  );
}

// ── Página principal ────────────────────────────────────────────
export default function Inventario() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);

  const [productos,       setProductos]       = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [modalProducto,   setModalProducto]   = useState(null);  // null | 'nuevo' | producto
  const [prodAEliminar,   setProdAEliminar]   = useState(null);
  const [prodAArchivar,   setProdAArchivar]   = useState(null);
  const [infoProducto,    setInfoProducto]    = useState(null);  // info modal (mobile)

  // Archivados: se cargan bajo demanda al abrir el panel "Ver archivados".
  const [verArchivados,   setVerArchivados]   = useState(false);
  const [archivados,      setArchivados]      = useState([]);
  const [archLoading,     setArchLoading]     = useState(false);
  const [archError,       setArchError]       = useState('');

  // Selección múltiple (admin, desktop) para borrado en lote.
  const [seleccionados,   setSeleccionados]   = useState(() => new Set());
  const [bulkOpen,        setBulkOpen]        = useState(false);
  const [bulkInfo,        setBulkInfo]        = useState(null); // { bloqueados, eliminables }
  const [bulkLoading,     setBulkLoading]     = useState(false);
  const [bulkDeleting,    setBulkDeleting]    = useState(false);
  const [bulkError,       setBulkError]       = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightAplicadoRef = useRef(null);

  useEffect(() => {
    let activo = true;
    api.get('/productos')
      .then(data => { if (activo) setProductos(data); })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, []);

  // Highlight desde ?highlight=<id> (alerta del nav)
  useEffect(() => {
    const id = searchParams.get('highlight');
    if (!id || loading || productos.length === 0) return;
    if (highlightAplicadoRef.current === id) return;

    const els = document.querySelectorAll(`[data-producto-id="${id}"]`);
    if (els.length === 0) return;

    highlightAplicadoRef.current = id;
    const visible = Array.from(els).find(e => e.offsetParent !== null) ?? els[0];
    visible.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  }, [searchParams, productos, loading, setSearchParams]);

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

  // ── Archivar / restaurar ───────────────────────────────
  const cargarArchivados = async () => {
    setArchError('');
    setArchLoading(true);
    try {
      const data = await api.get('/productos?archivados=1');
      setArchivados(data);
    } catch (err) {
      setArchError(err.message);
    } finally {
      setArchLoading(false);
    }
  };
  const toggleVerArchivados = () => {
    const abrir = !verArchivados;
    setVerArchivados(abrir);
    if (abrir) cargarArchivados();
  };
  const handleArchivar = async () => {
    const p = prodAArchivar;
    await api.patch(`/productos/${p.id}/archivar`, { archivado: true });
    setProductos(prev => prev.filter(x => x.id !== p.id));
    setSeleccionados(prev => { const n = new Set(prev); n.delete(p.id); return n; });
    if (verArchivados) setArchivados(prev => [...prev, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setProdAArchivar(null);
  };
  const restaurarProducto = async (p) => {
    const restaurado = await api.patch(`/productos/${p.id}/archivar`, { archivado: false });
    setArchivados(prev => prev.filter(x => x.id !== p.id));
    setProductos(prev => [...prev, restaurado].sort((a, b) => a.nombre.localeCompare(b.nombre)));
  };

  // ── Selección múltiple ─────────────────────────────────
  const toggleSeleccion = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const todosSeleccionados =
    productos.length > 0 && productos.every(p => seleccionados.has(p.id));
  const toggleTodos = () => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      const yaTodos = productos.every(p => next.has(p.id));
      productos.forEach(p => { if (yaTodos) next.delete(p.id); else next.add(p.id); });
      return next;
    });
  };
  const limpiarSeleccion = () => setSeleccionados(new Set());

  // Abre el modal de borrado múltiple: primero verifica (dry-run) cuáles tienen
  // ventas registradas para advertirlo antes de borrar.
  const abrirBulk = async () => {
    setBulkError('');
    setBulkInfo(null);
    setBulkLoading(true);
    setBulkOpen(true);
    try {
      const info = await api.post('/productos/eliminar-multiples', {
        ids: [...seleccionados], confirmar: false,
      });
      setBulkInfo(info);
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkLoading(false);
    }
  };
  const cerrarBulk = () => { setBulkOpen(false); setBulkInfo(null); setBulkError(''); };
  const confirmarBulk = async () => {
    setBulkError('');
    setBulkDeleting(true);
    try {
      const res = await api.post('/productos/eliminar-multiples', {
        ids: [...seleccionados], confirmar: true,
      });
      const eliminados = new Set(res.eliminados ?? []);
      setProductos(prev => prev.filter(p => !eliminados.has(p.id)));
      setSeleccionados(new Set());
      cerrarBulk();
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-100">

      {/* Cabecera (barra superior) */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500">{productos.length} producto(s) en inventario</p>
        </div>
        {esAdmin && (
          <button
            onClick={() => setModalProducto('nuevo')}
            aria-label="Agregar producto"
            className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {!loading && !error && productos.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 text-center py-12">
          <p className="text-gray-400 text-sm mb-3">Sin productos en inventario</p>
          {esAdmin && (
            <button
              onClick={() => setModalProducto('nuevo')}
              className="text-sm text-blue hover:text-blue-800 font-medium"
            >
              + Agregar el primero
            </button>
          )}
        </div>
      )}

      {!loading && !error && productos.length > 0 && (
        <>
          {/* Barra de acciones de selección múltiple (admin, desktop) */}
          {esAdmin && seleccionados.size > 0 && (
            <div className="hidden md:flex items-center justify-between gap-3 bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 mb-4">
              <span className="text-sm text-gray-700">
                <span className="font-semibold">{seleccionados.size}</span> seleccionado(s)
              </span>
              <div className="flex items-center gap-2">
                <button onClick={limpiarSeleccion} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
                  Limpiar
                </button>
                <button onClick={abrirBulk}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <IconoBasura />
                  Eliminar seleccionados
                </button>
              </div>
            </div>
          )}

          {/* Tabla — desktop */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {esAdmin && (
                      <th className="w-10 px-4 py-3">
                        <input type="checkbox" checked={todosSeleccionados} onChange={toggleTodos}
                          aria-label="Seleccionar todos"
                          className="w-4 h-4 rounded border-gray-300 text-blue focus:ring-blue cursor-pointer" />
                      </th>
                    )}
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
                      <tr key={p.id} data-producto-id={p.id} className={`transition-colors ${seleccionados.has(p.id) ? 'bg-light-blue/40' : `hover:bg-gray-50 ${rowCls}`}`}>
                        {esAdmin && (
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={seleccionados.has(p.id)} onChange={() => toggleSeleccion(p.id)}
                              aria-label={`Seleccionar ${p.nombre}`}
                              className="w-4 h-4 rounded border-gray-300 text-blue focus:ring-blue cursor-pointer" />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {es !== 'ok' && <IconoAdvertencia severity={es} />}
                            <span className="font-medium text-gray-800">{p.nombre}</span>
                          </div>
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
                              {Math.round(Number(p.stock_actual))}
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
                        <td className="px-4 py-3 text-gray-600">
                          {p.es_por_tapa
                            ? <>Tapas {formatoStock(p).equivalencia && <span className="text-gray-400">{formatoStock(p).equivalencia}</span>}</>
                            : pluralizarUnidad(p.stock_actual, p.unidad)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setModalProducto(p)}
                              className="p-1.5 text-gray-400 hover:text-blue hover:bg-light-blue rounded-lg transition-colors"
                              title="Editar"
                            >
                              <IconoLapiz />
                            </button>
                            {esAdmin && (
                              <button
                                onClick={() => setProdAArchivar(p)}
                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                title="Archivar (ocultar del inventario)"
                              >
                                <IconoArchivar />
                              </button>
                            )}
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
          </div>

          {/* Cards — mobile */}
          <div className="md:hidden space-y-3">
            {productos.map(p => {
              const es = p.estado_stock ?? 'ok';
              const rowCls = es === 'agotado' ? 'bg-red-50/40' : es === 'por_agotarse' ? 'bg-amber-50/40' : 'bg-white';
              return (
                <button
                  key={p.id}
                  data-producto-id={p.id}
                  type="button"
                  onClick={() => setInfoProducto(p)}
                  className={`w-full text-left rounded-xl shadow-sm border border-gray-100 px-4 py-3 hover:shadow-md active:opacity-80 transition ${rowCls}`}
                >
                  <div className="flex items-center gap-2">
                    {es !== 'ok' && <IconoAdvertencia severity={es} />}
                    <p className="font-medium text-gray-800 text-sm">{p.nombre}</p>
                  </div>
                  {p.categoria && (
                    <p className="text-xs text-gray-400 mt-0.5">{p.categoria}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-sm font-mono font-semibold text-gray-700">
                      {formatoStock(p).cantidad}
                    </span>
                    {p.es_por_tapa && formatoStock(p).equivalencia && (
                      <span className="text-xs text-gray-400">{formatoStock(p).equivalencia}</span>
                    )}
                    {es === 'agotado' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>
                    )}
                    {es === 'por_agotarse' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>
                    )}
                    {p.precio_unitario != null && (
                      <span className="text-xs text-gray-500">
                        ${Number(p.precio_unitario).toFixed(2)}{p.es_por_tapa ? '/tapa' : ''}
                      </span>
                    )}
                  </div>
                  {!p.es_por_tapa && p.unidad && (
                    <p className="text-xs text-gray-500 mt-0.5">Unidad: {p.unidad}</p>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Archivados */}
      {esAdmin && !loading && !error && (
        <div className="pt-2">
          <button
            type="button"
            onClick={toggleVerArchivados}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${verArchivados ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {verArchivados ? 'Ocultar archivados' : 'Ver productos archivados'}
          </button>

          {verArchivados && (
            <div className="mt-3">
              {archLoading ? (
                <p className="text-sm text-gray-400 py-4">Cargando…</p>
              ) : archError ? (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{archError}</div>
              ) : archivados.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-2">No hay productos archivados.</p>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                  {archivados.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{p.nombre}</p>
                        {p.categoria && <p className="text-xs text-gray-400">{p.categoria}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => restaurarProducto(p)}
                        className="flex-shrink-0 text-sm font-medium text-blue hover:text-blue-800 border border-blue/30 hover:bg-light-blue rounded-lg px-3 py-1.5 transition-colors"
                      >
                        Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      </div>

      {/* Modal info producto (mobile) */}
      {infoProducto && (() => {
        const p = infoProducto;
        const es = p.estado_stock ?? 'ok';
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 md:hidden">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900">Producto</h2>
                <button onClick={() => setInfoProducto(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-5 space-y-5 overflow-y-auto">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Nombre</p>
                  <p className="text-base font-medium text-gray-900">{p.nombre}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Categoría</p>
                  <p className="text-base text-gray-700">{p.categoria ?? <span className="text-gray-400 italic">Sin categoría</span>}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    {p.es_por_tapa ? 'Precio por tapa' : 'Precio unitario'}
                  </p>
                  <p className="text-base text-gray-700">
                    {p.precio_unitario != null ? `$${Number(p.precio_unitario).toFixed(2)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Stock actual</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-mono font-semibold text-gray-800">
                      {formatoStock(p).cantidad}
                    </span>
                    {p.es_por_tapa && formatoStock(p).equivalencia && (
                      <span className="text-sm text-gray-400">{formatoStock(p).equivalencia}</span>
                    )}
                    {es === 'agotado' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>
                    )}
                    {es === 'por_agotarse' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    {p.es_por_tapa ? 'Envase' : 'Unidad'}
                  </p>
                  <p className="text-base text-gray-700">
                    {p.es_por_tapa
                      ? (p.envase ? `${p.envase} · rinde ${p.tapas_por_envase} tapas` : `Rinde ${p.tapas_por_envase} tapas`)
                      : (p.unidad ?? <span className="text-gray-400 italic">—</span>)}
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setInfoProducto(null); setModalProducto(p); }}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue hover:opacity-90 text-white font-medium rounded-lg text-sm transition-colors"
                  >
                    <IconoLapiz />
                    Editar
                  </button>
                  {esAdmin && (
                    <button
                      type="button"
                      onClick={() => { setInfoProducto(null); setProdAArchivar(p); }}
                      className="w-full flex items-center justify-center gap-2 py-3 border border-amber-300 text-amber-700 hover:bg-amber-50 font-medium rounded-lg text-sm transition-colors"
                    >
                      <IconoArchivar />
                      Archivar
                    </button>
                  )}
                  {esAdmin && (
                    <button
                      type="button"
                      onClick={() => { setInfoProducto(null); setProdAEliminar(p); }}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition-colors"
                    >
                      <IconoBasura />
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal crear / editar */}
      {modalProducto && (
        <ModalProducto
          producto={modalProducto === 'nuevo' ? null : modalProducto}
          esAdmin={esAdmin}
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

      {/* Modal confirmar archivar */}
      {prodAArchivar && (
        <ModalArchivar
          producto={prodAArchivar}
          onClose={() => setProdAArchivar(null)}
          onConfirmar={handleArchivar}
        />
      )}

      {/* Modal: Eliminar varios (con advertencia de ventas registradas) */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {bulkLoading ? (
                <p className="text-sm text-gray-500 text-center py-6">Verificando…</p>
              ) : bulkError ? (
                <>
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{bulkError}</div>
                  <button type="button" onClick={cerrarBulk}
                    className="w-full border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
                    Cerrar
                  </button>
                </>
              ) : bulkInfo && (() => {
                const bloqueados = bulkInfo.bloqueados ?? [];
                const nEliminables = (bulkInfo.eliminables ?? []).length;
                const todosBloqueados = nEliminables === 0;
                return (
                  <>
                    <div className={`flex items-center justify-center w-12 h-12 rounded-full mx-auto mb-4 ${todosBloqueados ? 'bg-amber-100' : 'bg-red-100'}`}>
                      <svg className={`w-6 h-6 ${todosBloqueados ? 'text-amber-600' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 text-center mb-2">
                      {todosBloqueados ? 'No se puede eliminar' : 'Eliminar productos'}
                    </h3>

                    {bloqueados.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 mb-3">
                        <p className="font-medium mb-1">
                          {todosBloqueados
                            ? 'Ninguno se puede eliminar porque tiene ventas registradas:'
                            : 'Estos tienen ventas registradas y no se eliminarán:'}
                        </p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {bloqueados.map(p => <li key={p.id}>{p.nombre}</li>)}
                        </ul>
                      </div>
                    )}

                    {!todosBloqueados && (
                      <p className="text-sm text-gray-500 text-center mb-4">
                        {bloqueados.length > 0
                          ? `Se eliminarán los otros ${nEliminables} producto(s). Esta acción no se puede deshacer.`
                          : `¿Eliminar ${nEliminables} producto(s)? Esta acción no se puede deshacer.`}
                      </p>
                    )}

                    <div className="flex gap-3">
                      <button type="button" onClick={cerrarBulk}
                        className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors">
                        {todosBloqueados ? 'Cerrar' : 'Cancelar'}
                      </button>
                      {!todosBloqueados && (
                        <button type="button" onClick={confirmarBulk} disabled={bulkDeleting}
                          className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors">
                          {bulkDeleting ? 'Eliminando…' : `Eliminar ${nEliminables}`}
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
