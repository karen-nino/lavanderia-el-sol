import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import SucursalBar from '../components/SucursalBar';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';
const NUM_CLS =
  `${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const UNIDADES_VOLUMEN = ['Litros', 'Mililitros'];

// Convierte un valor a mililitros según su unidad.
function aMl(valor, unidad) {
  const v = Number(valor) || 0;
  return unidad === 'Litros' ? v * 1000 : v;
}

// ── Conversiones de existencias (todo se guarda en TAPAS) ───────
function tapasPorBotella(p) {
  const t = Number(p.tapas_por_botella)
    || (Number(p.botella_ml) && Number(p.tapa_ml) ? Math.floor(Number(p.botella_ml) / Number(p.tapa_ml)) : 0);
  return t > 0 ? t : 0;
}
function botellasPorBidon(p) {
  const b = Number(p.botellas_por_bidon)
    || (Number(p.volumen_envase_ml) && Number(p.botella_ml) ? Math.floor(Number(p.volumen_envase_ml) / Number(p.botella_ml)) : 0);
  return b > 0 ? b : 0;
}
// Descompone unas tapas en "X botellas y Y tapas".
function desglosarBotellas(tapas, p) {
  const tpb = tapasPorBotella(p);
  const t = Math.round(Number(tapas) || 0);
  if (tpb <= 0) return { botellas: 0, tapas: t };
  return { botellas: Math.floor(t / tpb), tapas: t % tpb };
}
// Descompone el líquido a granel en "N bidones y M botellas".
function desglosarBidones(tapasGranel, p) {
  const tpb = tapasPorBotella(p);
  const tapasPorBidon = tpb * botellasPorBidon(p);
  const t = Math.round(Number(tapasGranel) || 0);
  if (tapasPorBidon <= 0) return { bidones: 0, botellas: tpb > 0 ? Math.floor(t / tpb) : 0 };
  return { bidones: Math.floor(t / tapasPorBidon), botellas: tpb > 0 ? Math.floor((t % tapasPorBidon) / tpb) : 0 };
}
function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`;
}
// Texto de las botellas rellenadas (con las tapas sueltas si las hay).
function textoRellenadas(p) {
  const { botellas, tapas } = desglosarBotellas(p.stock_actual, p);
  const partes = [plural(botellas, 'botella', 'botellas')];
  if (tapas > 0) partes.push(plural(tapas, 'tapa', 'tapas'));
  return partes.join(' y ');
}
// Texto del líquido a granel (bidones + botellas equivalentes).
function textoGranel(p) {
  if (p.tipo_liquido !== 'granel') return '';
  const { bidones, botellas } = desglosarBidones(p.stock_granel_tapas, p);
  const partes = [];
  if (bidones > 0) partes.push(plural(bidones, 'bidón', 'bidones'));
  partes.push(plural(botellas, 'botella', 'botellas'));
  return partes.join(' y ');
}
function precioTxt(v) {
  return v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '—';
}
function fechaHoraCorta(iso) {
  try {
    const d = new Date(iso);
    const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    const hora = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
    return `${fecha} · ${hora}`;
  } catch {
    return '';
  }
}

const FORM_VACIO = {
  nombre:            '',
  marca:             '',
  tipo_liquido:      'granel',
  envase:            'Bidón',
  bidon_valor:       '',
  bidon_unidad:      'Litros',
  botella_ml:        '',
  metodo_tapa:       'ml',   // 'ml' (tamaño de la tapa) | 'tapas' (tapas por botella)
  tapa_ml:           '',
  tapas_por_botella: '',
  precio_tapa:          '',
  precio_botella:       '',
  stock_minimo_botellas: '0',   // el aviso se captura en botellas; se guarda en tapas
};

// ── Modal crear / editar ────────────────────────────────────────
function ModalProducto({ producto, onClose, onGuardado, marcas = [] }) {
  const esEdicion = Boolean(producto);
  const [form, setForm] = useState(producto
    ? {
        nombre:         producto.nombre,
        marca:          producto.marca ?? '',
        tipo_liquido:   producto.tipo_liquido ?? 'granel',
        envase:         producto.envase ?? 'Bidón',
        bidon_valor:    producto.volumen_envase_ml
          ? (producto.volumen_envase_ml % 1000 === 0 ? String(producto.volumen_envase_ml / 1000) : String(producto.volumen_envase_ml))
          : '',
        bidon_unidad:   producto.volumen_envase_ml && producto.volumen_envase_ml % 1000 !== 0 ? 'Mililitros' : 'Litros',
        botella_ml:        producto.botella_ml ?? '',
        metodo_tapa:       'ml',
        tapa_ml:           producto.tapa_ml ?? '',
        tapas_por_botella: '',
        precio_tapa:       producto.precio_unitario ?? '',
        precio_botella:    producto.precio_botella ?? '',
        // El mínimo se guarda en tapas; en el formulario se muestra en botellas.
        stock_minimo_botellas: tapasPorBotella(producto) > 0
          ? String(Math.round(Number(producto.stock_minimo ?? 0) / tapasPorBotella(producto)))
          : String(producto.stock_minimo ?? 0),
      }
    : FORM_VACIO
  );
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const esGranel = form.tipo_liquido === 'granel';

  // Cálculos en vivo para mostrar el rendimiento.
  const botellaMl = Number(form.botella_ml) || 0;
  const bidonMl   = aMl(form.bidon_valor, form.bidon_unidad);
  const tapaMl    = Number(form.tapa_ml) || 0;
  // Rendimiento: por tamaño de tapa (mL) o por tapas por botella (directo).
  const tapasBotella = form.metodo_tapa === 'ml'
    ? (tapaMl > 0 ? Math.floor(botellaMl / tapaMl) : 0)
    : (Number(form.tapas_por_botella) || 0);
  const botellasBidon = botellaMl > 0 ? Math.floor(bidonMl / botellaMl) : 0;

  const marcaOptions = form.marca && !marcas.includes(form.marca) ? [form.marca, ...marcas] : marcas;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!esEdicion && !confirmar) { setConfirmar(true); return; }
    ejecutarGuardado();
  };

  const ejecutarGuardado = async () => {
    setError('');
    setLoading(true);

    const body = {
      nombre:            form.nombre.trim(),
      marca:             esGranel ? null : (form.marca || null),
      tipo_liquido:      form.tipo_liquido,
      unidad:            'Tapas',
      envase:            esGranel ? 'Bidón' : null,
      precio_unitario:   form.precio_tapa !== '' ? Number(form.precio_tapa) : null,
      precio_botella:    form.precio_botella !== '' ? Number(form.precio_botella) : null,
      volumen_envase_ml: esGranel && bidonMl > 0 ? bidonMl : null,
      botella_ml:        botellaMl > 0 ? botellaMl : null,
      // La tapa va por tamaño (mL) o por tapas por botella (el backend deriva el mL).
      tapa_ml:           form.metodo_tapa === 'ml' && tapaMl > 0 ? tapaMl : null,
      tapas_por_botella: form.metodo_tapa === 'tapas' ? (Number(form.tapas_por_botella) || null) : null,
      // El aviso se captura en botellas y se guarda en tapas.
      stock_minimo:      tapasBotella > 0
        ? Math.round((Number(form.stock_minimo_botellas) || 0) * tapasBotella)
        : (Number(form.stock_minimo_botellas) || 0),
    };

    try {
      const resultado = esEdicion
        ? await api.put(`/productos/${producto.id}`, body)
        : await api.post('/productos', body);
      onGuardado(resultado, esEdicion);
    } catch (err) {
      setError(err.message);
      setConfirmar(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
          {/* Tipo de líquido */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tipo de producto <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {[['granel', 'Granel', 'Se rellena desde un envase'], ['marca', 'De marca', 'Se compra embotellado']].map(([val, label, hint]) => (
                <button
                  key={val} type="button"
                  onClick={() => setForm(f => ({ ...f, tipo_liquido: val }))}
                  className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.tipo_liquido === val ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="block">{label}</span>
                  <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text" name="nombre" required
              value={form.nombre} onChange={handleChange}
              placeholder="Ej. Suavizante" className={INPUT_CLS}
            />
          </div>

          {/* Marca (solo productos de marca) */}
          {!esGranel && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Marca <span className="text-red-500">*</span>
              </label>
              <select name="marca" required value={form.marca} onChange={handleChange} className={INPUT_CLS}>
                <option value="">Seleccionar...</option>
                {marcaOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Volúmenes */}
          <div className="space-y-3">
            {esGranel && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1.5">
                  ¿Cuánto trae el bidón? <span className="text-red-500">*</span>
                </p>
                <div className="flex gap-2">
                  <input
                    type="number" name="bidon_valor" min="0" step="any" required
                    value={form.bidon_valor} onChange={handleChange} placeholder="Ej. 20"
                    className={`${NUM_CLS} flex-1 min-w-0`}
                  />
                  <select
                    name="bidon_unidad" value={form.bidon_unidad} onChange={handleChange}
                    className="w-28 flex-shrink-0 px-3 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
                  >
                    {UNIDADES_VOLUMEN.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1.5">
                ¿De qué tamaño es la botella? (mL) <span className="text-red-500">*</span>
              </p>
              <input
                type="number" name="botella_ml" min="1" step="any" required
                value={form.botella_ml} onChange={handleChange} placeholder="Ej. 800"
                className={NUM_CLS}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1.5">
                Rendimiento de la tapa/medida <span className="text-red-500">*</span>
              </p>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, metodo_tapa: 'ml' }))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.metodo_tapa === 'ml' ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tamaño de tapa (mL)
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, metodo_tapa: 'tapas' }))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.metodo_tapa === 'tapas' ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Tapas por botella
                </button>
              </div>
              {form.metodo_tapa === 'ml' ? (
                <input
                  type="number" name="tapa_ml" min="1" step="any" required
                  value={form.tapa_ml} onChange={handleChange} placeholder="Ej. 200 mL"
                  className={NUM_CLS}
                />
              ) : (
                <>
                  <input
                    type="number" name="tapas_por_botella" min="1" step="1" required
                    value={form.tapas_por_botella} onChange={handleChange} placeholder="Ej. 4 tapas por botella"
                    className={NUM_CLS}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Aproximado: cuántas tapas/medidas salen de una botella.
                  </p>
                </>
              )}
            </div>
            {/* Rendimiento calculado */}
            <div className={`rounded-lg px-4 py-3 text-sm ${tapasBotella > 0 ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
              {tapasBotella > 0 ? (
                <>
                  Rinde <span className="font-bold">{tapasBotella} tapas</span> por botella
                  {esGranel && botellasBidon > 0 && <> · <span className="font-bold">{botellasBidon} botellas</span> por bidón</>}.
                </>
              ) : 'Captura los tamaños de botella y tapa para calcular el rendimiento.'}
            </div>
          </div>

          {/* Precios */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Precio por tapa ($)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" name="precio_tapa" min="0" step="any"
                  value={form.precio_tapa} onChange={handleChange} placeholder="0.00"
                  className={`${NUM_CLS} pl-7`}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Por Encargo</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Precio por botella ($)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" name="precio_botella" min="0" step="any"
                  value={form.precio_botella} onChange={handleChange} placeholder="0.00"
                  className={`${NUM_CLS} pl-7`}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Autoservicio</p>
            </div>
          </div>

          {/* Las existencias (botellas rellenadas / bidones) se cargan con una
              Entrada, no al dar de alta el producto. */}

          {/* Alerta de stock bajo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Avisar cuando queden (botellas)
            </label>
            <input
              type="number" name="stock_minimo_botellas" min="0" step="1"
              value={form.stock_minimo_botellas} onChange={handleChange} placeholder="Ej. 5"
              className={NUM_CLS}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
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

    {/* Confirmación antes de agregar un producto nuevo */}
    {confirmar && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-light-blue rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Agregar producto</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                ¿Agregar <span className="font-medium text-gray-700">{form.nombre.trim() || 'este producto'}</span> al inventario?
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button" onClick={() => setConfirmar(false)} disabled={loading}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button" onClick={ejecutarGuardado} disabled={loading}
              className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
            >
              {loading ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ── Modal Entrada / Salida ──────────────────────────────────────
function ModalMovimiento({ producto, tipo, onClose, onDone }) {
  const esGranel = producto.tipo_liquido === 'granel';
  const [destino, setDestino] = useState('botellas');
  const [unidad,  setUnidad]  = useState('botella');
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo]   = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const esEntrada = tipo === 'entrada';
  const unidadesDisponibles = destino === 'granel' ? ['bidon', 'botella', 'tapa'] : ['botella', 'tapa'];
  const unidadLabel = { bidon: 'Bidones', botella: 'Botellas', tapa: 'Tapas' };

  const cambiarDestino = (d) => {
    setDestino(d);
    setUnidad(d === 'granel' ? 'bidon' : 'botella');
  };

  const enviar = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await api.post(`/productos/${producto.id}/movimiento`, {
        tipo, destino, unidad, cantidad: Number(cantidad), motivo: motivo.trim() || null,
      });
      onDone(resp);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {esEntrada ? 'Registrar entrada' : 'Registrar salida'}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">{producto.nombre}</p>
        </div>

        {/* Destino (solo granel puede elegir) */}
        {esGranel && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">¿A qué existencia?</label>
            <div className="flex gap-2">
              {[['botellas', 'Botellas rellenadas'], ['granel', 'A granel (bidón)']].map(([val, label]) => (
                <button
                  key={val} type="button" onClick={() => cambiarDestino(val)}
                  className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                    destino === val ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Cantidad</label>
            <input
              type="number" min="0" step="any" value={cantidad}
              onChange={(e) => setCantidad(e.target.value)} className={NUM_CLS}
            />
          </div>
          <div className="w-32">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Unidad</label>
            <select
              value={unidad} onChange={(e) => setUnidad(e.target.value)}
              className="w-full px-3 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
            >
              {unidadesDisponibles.map(u => <option key={u} value={u}>{unidadLabel[u]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Motivo (opcional)</label>
          <input
            type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={esEntrada ? 'Ej. Compra' : 'Ej. Derrame'} className={INPUT_CLS}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button" onClick={onClose} disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={enviar} disabled={loading || !(Number(cantidad) > 0)}
            className={`flex-1 text-white font-medium py-3.5 rounded-lg text-base transition-colors disabled:opacity-60 ${
              esEntrada ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {loading ? 'Guardando...' : esEntrada ? 'Registrar entrada' : 'Registrar salida'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Rellenar ──────────────────────────────────────────────
function ModalRellenar({ producto, onClose, onDone }) {
  const tpb = tapasPorBotella(producto);
  const maxBotellas = tpb > 0 ? Math.floor(Number(producto.stock_granel_tapas) / tpb) : 0;
  const [botellas, setBotellas] = useState(String(Math.min(maxBotellas, botellasPorBidon(producto) || maxBotellas)));
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const n = Number(botellas);
  const invalido = !Number.isInteger(n) || n <= 0 || n > maxBotellas;

  const enviar = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await api.post(`/productos/${producto.id}/rellenar`, { botellas: n });
      onDone(resp);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Rellenar botellas</h3>
          <p className="text-sm text-gray-500 mt-0.5">{producto.nombre}</p>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
          A granel disponible: <span className="font-semibold text-gray-800">{textoGranel(producto)}</span>
          <br />Alcanza para <span className="font-semibold text-gray-800">{maxBotellas} botella(s)</span>.
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ¿Cuántas botellas rellenaste?
          </label>
          <input
            type="number" min="1" max={maxBotellas} step="1" value={botellas}
            onChange={(e) => setBotellas(e.target.value)} className={NUM_CLS}
          />
          {n > 0 && !invalido && (
            <p className="text-xs text-gray-500 mt-1">
              Quedarán {maxBotellas - n} botella(s) de líquido en el bidón.
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button" onClick={onClose} disabled={loading}
            className="flex-1 border border-gray-300 text-gray-700 font-medium py-3.5 rounded-lg text-base hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button" onClick={enviar} disabled={loading || invalido}
            className="flex-1 bg-blue hover:opacity-90 disabled:opacity-60 text-white font-medium py-3.5 rounded-lg text-base transition-colors"
          >
            {loading ? 'Rellenando...' : 'Rellenar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal Historial ─────────────────────────────────────────────
const MOV_LABEL = {
  entrada: 'Entrada', salida: 'Salida', rellenar: 'Rellenado',
  venta: 'Venta', reserva: 'Reserva', liberacion: 'Liberación', ajuste: 'Ajuste',
};
const MOV_COLOR = {
  entrada: 'text-green-700 bg-green-50', rellenar: 'text-blue bg-light-blue',
  salida: 'text-red-700 bg-red-50', venta: 'text-red-700 bg-red-50',
  reserva: 'text-amber-700 bg-amber-50', liberacion: 'text-gray-600 bg-gray-100',
  ajuste: 'text-gray-600 bg-gray-100',
};
function ModalHistorial({ producto, onClose }) {
  const [movs, setMovs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    api.get(`/productos/${producto.id}/movimientos`)
      .then(data => { if (activo) setMovs(data); })
      .catch(err => { if (activo) setError(err.message); });
    return () => { activo = false; };
  }, [producto.id]);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Historial de movimientos</h2>
            <p className="text-sm text-gray-500">{producto.nombre}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
          {!error && movs === null && <p className="text-sm text-gray-400 py-4 text-center">Cargando…</p>}
          {!error && movs?.length === 0 && <p className="text-sm text-gray-400 italic py-4 text-center">Sin movimientos todavía.</p>}
          {!error && movs?.length > 0 && (
            <ul className="divide-y divide-gray-50">
              {movs.map(m => (
                <li key={m.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${MOV_COLOR[m.tipo] ?? 'text-gray-600 bg-gray-100'}`}>
                        {MOV_LABEL[m.tipo] ?? m.tipo}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{m.descripcion ?? `${m.cantidad_tapas} tapas`}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {m.destino === 'granel' ? 'A granel' : 'Botellas'}
                      {m.motivo ? ` · ${m.motivo}` : ''}
                      {m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{fechaHoraCorta(m.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
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
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
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
function IconoHistorial() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IconoAdvertencia({ severity }) {
  const cls = severity === 'agotado' ? 'text-red-600' : 'text-amber-500';
  return (
    <svg className={`w-4 h-4 flex-shrink-0 block ${cls}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-label={severity === 'agotado' ? 'Agotado' : 'Stock bajo'}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

// Etiqueta para productos recién dados de alta (sin existencia todavía).
function ChipNuevo() {
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Nuevo</span>;
}

// Chip de tipo de producto (granel / marca).
function ChipTipo({ tipo }) {
  if (tipo !== 'granel' && tipo !== 'marca') return null;
  const cfg = tipo === 'granel'
    ? { label: 'Granel', cls: 'bg-light-blue text-blue' }
    : { label: 'Marca', cls: 'bg-purple-100 text-purple-700' };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

function BadgeEstado({ estado }) {
  if (estado === 'agotado') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>;
  if (estado === 'por_agotarse') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>;
  return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
}

// Badge del granel (bidón). Solo se dibuja algo cuando está por acabarse o agotado.
function BadgeGranel({ estado }) {
  if (estado === 'agotado') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Sin granel</span>;
  if (estado === 'por_agotarse') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Por acabarse</span>;
  return null;
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
  const [modalMovimiento, setModalMovimiento] = useState(null);  // { producto, tipo }
  const [modalRellenar,   setModalRellenar]   = useState(null);  // producto
  const [modalHistorial,  setModalHistorial]  = useState(null);  // producto
  const [stockOcultoSig,  setStockOcultoSig]  = useState(null);  // firma del aviso de stock bajo descartado
  const [granelOcultoSig, setGranelOcultoSig] = useState(null);  // firma del aviso de granel descartado
  // Productos recién creados en esta sesión: no disparan advertencias (nacen en
  // cero) hasta que se les cargue existencia con una entrada.
  const [recienCreados,   setRecienCreados]   = useState(() => new Set());

  // Archivados: se cargan bajo demanda al abrir el panel "Ver archivados".
  const [verArchivados,   setVerArchivados]   = useState(false);
  const [archivados,      setArchivados]      = useState([]);
  const [archLoading,     setArchLoading]     = useState(false);
  const [archError,       setArchError]       = useState('');

  // Selección múltiple (admin, desktop) para borrado en lote.
  const [seleccionados,   setSeleccionados]   = useState(() => new Set());
  const [bulkOpen,        setBulkOpen]        = useState(false);
  const [bulkInfo,        setBulkInfo]        = useState(null);
  const [bulkLoading,     setBulkLoading]     = useState(false);
  const [bulkDeleting,    setBulkDeleting]    = useState(false);
  const [bulkError,       setBulkError]       = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightAplicadoRef = useRef(null);

  // Catálogo editable de marcas (Ajustes → Inventario). Solo las activas.
  const [marcas, setMarcas] = useState([]);

  useEffect(() => {
    let activo = true;
    api.get('/etiquetas/marcas-producto')
      .then(data => { if (activo) setMarcas((data ?? []).filter(x => x.activo).map(x => x.nombre)); })
      .catch(() => {});
    return () => { activo = false; };
  }, []);

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

  const stockBajo = productos.filter(p => p.estado_stock !== 'ok' && !recienCreados.has(p.id));
  // El aviso de stock bajo también se puede ocultar en la sesión (firma con el
  // stock, así reaparece si cambia).
  const stockSig = stockBajo.map(p => `${p.id}:${p.stock_actual}`).join(',');
  const mostrarStockBajo = stockBajo.length > 0 && stockSig !== stockOcultoSig;
  // Granel por acabarse o agotado (solo productos granel).
  const granelBajo = productos.filter(p => p.tipo_liquido === 'granel' && p.estado_granel && p.estado_granel !== 'ok' && !recienCreados.has(p.id));
  // El aviso de granel se puede ocultar en la sesión; su firma incluye el stock,
  // así que reaparece si el granel cambia o entra otro producto a la lista.
  const granelSig = granelBajo.map(p => `${p.id}:${p.stock_granel_tapas}`).join(',');
  const mostrarGranel = granelBajo.length > 0 && granelSig !== granelOcultoSig;

  // Reemplaza un producto en la lista (tras editar / movimiento / rellenar). Si
  // ya tiene existencia, deja de considerarse "recién creado" (vuelve a avisar).
  const reemplazarProducto = (prod) => {
    setProductos(prev => prev.map(p => (p.id === prod.id ? prod : p)));
    setInfoProducto(prev => (prev && prev.id === prod.id ? prod : prev));
    if (Number(prod.stock_actual) > 0 || Number(prod.stock_granel_tapas) > 0) {
      setRecienCreados(prev => {
        if (!prev.has(prod.id)) return prev;
        const next = new Set(prev); next.delete(prod.id); return next;
      });
    }
  };

  const handleGuardado = (resultado, esEdicion) => {
    if (esEdicion) {
      reemplazarProducto(resultado);
    } else {
      setProductos(prev => [...prev, resultado].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      // Nace en cero: no dispares advertencias hasta que se le cargue existencia.
      setRecienCreados(prev => new Set(prev).add(resultado.id));
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

  const abrirBulk = async () => {
    setBulkError('');
    setBulkInfo(null);
    setBulkLoading(true);
    setBulkOpen(true);
    try {
      const info = await api.post('/productos/eliminar-multiples', { ids: [...seleccionados], confirmar: false });
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
      const res = await api.post('/productos/eliminar-multiples', { ids: [...seleccionados], confirmar: true });
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

  // Acciones de stock disponibles para todos (operativas).
  const accionesStock = (p, { compact = false } = {}) => (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setModalMovimiento({ producto: p, tipo: 'entrada' }); }}
        className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
        title="Entrada"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setModalMovimiento({ producto: p, tipo: 'salida' }); }}
        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        title="Salida"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
      </button>
      {p.tipo_liquido === 'granel' && (
        <button
          onClick={(e) => { e.stopPropagation(); setModalRellenar(p); }}
          className="p-1.5 text-gray-400 hover:text-blue hover:bg-light-blue rounded-lg transition-colors"
          title="Rellenar botellas desde el bidón"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
      )}
      {!compact && (
        <button
          onClick={(e) => { e.stopPropagation(); setModalHistorial(p); }}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Ver historial"
        >
          <IconoHistorial />
        </button>
      )}
    </>
  );

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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

      {/* Alerta stock bajo */}
      {mostrarStockBajo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 relative">
          <button
            onClick={() => setStockOcultoSig(stockSig)}
            aria-label="Descartar aviso"
            className="absolute top-3 right-3 text-amber-400 hover:text-amber-600 p-0.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-2 mb-2 pr-6">
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
              <span key={p.id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5">
                {p.nombre}
                {p.tipo_liquido === 'granel' && Number(p.stock_granel_tapas) >= tapasPorBotella(p) && tapasPorBotella(p) > 0 && (
                  <button
                    onClick={() => setModalRellenar(p)}
                    className="underline hover:no-underline font-semibold"
                  >
                    Rellenar
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Alerta de granel por acabarse / agotado */}
      {mostrarGranel && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 relative">
          <button
            onClick={() => setGranelOcultoSig(granelSig)}
            aria-label="Descartar aviso"
            className="absolute top-3 right-3 text-orange-400 hover:text-orange-600 p-0.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-2 mb-2 pr-6">
            <svg className="w-4 h-4 text-orange-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-semibold text-orange-800">
              Granel por acabarse en {granelBajo.length} producto(s) — hay que comprar más bidones
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {granelBajo.map(p => (
              <span key={p.id} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                {p.nombre}{p.estado_granel === 'agotado' ? ' (sin granel)' : ''}
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
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Precios</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Botellas rellenadas</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">A granel</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {productos.map(p => {
                    const es = recienCreados.has(p.id) ? 'ok' : (p.estado_stock ?? 'ok');
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
                            <ChipTipo tipo={p.tipo_liquido} />
                            {recienCreados.has(p.id) && <ChipNuevo />}
                          </div>
                          {p.marca && <p className="text-xs text-gray-400 mt-0.5">{p.marca}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          <div>Tapa: <span className="font-medium text-gray-700">{precioTxt(p.precio_unitario)}</span></div>
                          <div>Botella: <span className="font-medium text-gray-700">{precioTxt(p.precio_botella)}</span></div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800">{textoRellenadas(p)}</span>
                            <BadgeEstado estado={es} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {p.tipo_liquido === 'granel'
                            ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>{textoGranel(p)}</span>
                                <BadgeGranel estado={recienCreados.has(p.id) ? 'ok' : p.estado_granel} />
                              </div>
                            )
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {accionesStock(p)}
                            {esAdmin && (
                              <button
                                onClick={() => setModalProducto(p)}
                                className="p-1.5 text-gray-400 hover:text-blue hover:bg-light-blue rounded-lg transition-colors"
                                title="Editar"
                              >
                                <IconoLapiz />
                              </button>
                            )}
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
              const es = recienCreados.has(p.id) ? 'ok' : (p.estado_stock ?? 'ok');
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
                    <ChipTipo tipo={p.tipo_liquido} />
                            {recienCreados.has(p.id) && <ChipNuevo />}
                  </div>
                  {p.marca && <p className="text-xs text-gray-400 mt-0.5">{p.marca}</p>}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-sm font-medium text-gray-700">{textoRellenadas(p)}</span>
                    <BadgeEstado estado={es} />
                  </div>
                  {p.tipo_liquido === 'granel' && (
                    <p className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1.5">
                      <span>A granel: {textoGranel(p)}</span>
                      <BadgeGranel estado={recienCreados.has(p.id) ? 'ok' : p.estado_granel} />
                    </p>
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
                        {p.marca && <p className="text-xs text-gray-400">{p.marca}</p>}
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
        const es = recienCreados.has(p.id) ? 'ok' : (p.estado_stock ?? 'ok');
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
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-gray-900">{p.nombre}</p>
                    <ChipTipo tipo={p.tipo_liquido} />
                            {recienCreados.has(p.id) && <ChipNuevo />}
                  </div>
                  {p.marca && <p className="text-sm text-gray-500 mt-0.5">{p.marca}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Precio por tapa</p>
                    <p className="text-base text-gray-700">{precioTxt(p.precio_unitario)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Precio por botella</p>
                    <p className="text-base text-gray-700">{precioTxt(p.precio_botella)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Botellas rellenadas</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-medium text-gray-800">{textoRellenadas(p)}</span>
                    <BadgeEstado estado={es} />
                  </div>
                </div>
                {p.tipo_liquido === 'granel' && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">A granel (bidón)</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base text-gray-700">{textoGranel(p)}</span>
                      <BadgeGranel estado={recienCreados.has(p.id) ? 'ok' : p.estado_granel} />
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setModalMovimiento({ producto: p, tipo: 'entrada' }); }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 border border-green-300 text-green-700 hover:bg-green-50 font-medium rounded-lg text-sm transition-colors"
                    >
                      + Entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => { setModalMovimiento({ producto: p, tipo: 'salida' }); }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 border border-red-300 text-red-700 hover:bg-red-50 font-medium rounded-lg text-sm transition-colors"
                    >
                      − Salida
                    </button>
                  </div>
                  {p.tipo_liquido === 'granel' && (
                    <button
                      type="button"
                      onClick={() => { setModalRellenar(p); }}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-blue hover:opacity-90 text-white font-medium rounded-lg text-sm transition-colors"
                    >
                      Rellenar botellas
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setModalHistorial(p); }}
                    className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg text-sm transition-colors"
                  >
                    <IconoHistorial />
                    Ver historial
                  </button>
                  {esAdmin && (
                    <button
                      type="button"
                      onClick={() => { setInfoProducto(null); setModalProducto(p); }}
                      className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg text-sm transition-colors"
                    >
                      <IconoLapiz />
                      Editar
                    </button>
                  )}
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
          marcas={marcas}
          onClose={() => setModalProducto(null)}
          onGuardado={handleGuardado}
        />
      )}

      {/* Modal entrada / salida */}
      {modalMovimiento && (
        <ModalMovimiento
          producto={modalMovimiento.producto}
          tipo={modalMovimiento.tipo}
          onClose={() => setModalMovimiento(null)}
          onDone={(prod) => { reemplazarProducto(prod); setModalMovimiento(null); }}
        />
      )}

      {/* Modal rellenar */}
      {modalRellenar && (
        <ModalRellenar
          producto={modalRellenar}
          onClose={() => setModalRellenar(null)}
          onDone={(prod) => { reemplazarProducto(prod); setModalRellenar(null); }}
        />
      )}

      {/* Modal historial */}
      {modalHistorial && (
        <ModalHistorial producto={modalHistorial} onClose={() => setModalHistorial(null)} />
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
