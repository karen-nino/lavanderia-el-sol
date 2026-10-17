import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { esAdmin as esAdminFn } from '../lib/roles';
import { textoBotellas, textoGranel as textoGranelFmt, lineasEntradas, lineasSalidas, lineasDevuelto } from '../lib/formatoInventario';
import { imprimirReporte, descargarReporteCSV } from '../lib/exportReporteInventario';
import { fechaLarga } from '../lib/exportUtils';
import { formatHora12 } from '../lib/fecha';
import SucursalBar from '../components/SucursalBar';
import Selector from '../components/Selector';

const INPUT_CLS =
  'w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition';
const NUM_CLS =
  `${INPUT_CLS} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const UNIDADES_VOLUMEN = ['Litros', 'Mililitros'];

/** Convierte un valor a mililitros según su unidad. */
function aMl(valor, unidad) {
  const v = Number(valor) || 0;
  return unidad === 'Litros' ? v * 1000 : v;
}

// ── Conversiones de existencias (todo se guarda en MEDIDAS) ───────
function medidasPorBotella(p) {
  const t = Number(p.medidas_por_botella)
    || (Number(p.botella_ml) && Number(p.medida_ml) ? Math.floor(Number(p.botella_ml) / Number(p.medida_ml)) : 0);
  return t > 0 ? t : 0;
}
function botellasPorBidon(p) {
  const b = Number(p.botellas_por_bidon)
    || (Number(p.volumen_envase_ml) && Number(p.botella_ml) ? Math.floor(Number(p.volumen_envase_ml) / Number(p.botella_ml)) : 0);
  return b > 0 ? b : 0;
}
function medidasPorBidon(p) {
  return medidasPorBotella(p) * botellasPorBidon(p);
}
/** Medidas → "X botellas y Y medidas". */
function desglosarBotellas(medidas, p) {
  const tpb = medidasPorBotella(p);
  const t = Math.round(Number(medidas) || 0);
  if (tpb <= 0) return { botellas: 0, medidas: t };
  return { botellas: Math.floor(t / tpb), medidas: t % tpb };
}
/** Granel → "N bidones y M botellas". */
function desglosarBidones(medidasGranel, p) {
  const tpb = medidasPorBotella(p);
  const medidasPorBidon = tpb * botellasPorBidon(p);
  const t = Math.round(Number(medidasGranel) || 0);
  if (medidasPorBidon <= 0) return { bidones: 0, botellas: tpb > 0 ? Math.floor(t / tpb) : 0 };
  return { bidones: Math.floor(t / medidasPorBidon), botellas: tpb > 0 ? Math.floor((t % medidasPorBidon) / tpb) : 0 };
}
function plural(n, sing, plur) {
  return `${n} ${n === 1 ? sing : plur}`;
}
/** El granel en polvo se cuenta por piezas: se comporta como un producto de marca. */
function esPolvo(p) {
  return p?.clase !== 'bolsa' && p?.forma === 'polvo';
}
function porUnidad(p) {
  if (p?.se_vende_por_unidad != null) return Boolean(p.se_vende_por_unidad);
  return p?.tipo_liquido === 'marca' || esPolvo(p);
}
/** El granel líquido es el único con bidón: se rellena y lleva dos existencias. */
function esGranelLiquido(p) {
  return p?.clase !== 'bolsa' && p?.tipo_liquido === 'granel' && !esPolvo(p);
}
/** Unidad de la existencia: botellas (granel líquido) o piezas (marca y polvo). */
function unidadVenta(p, n = 2) {
  if (p.clase === 'bolsa') return n === 1 ? 'bolsa' : 'bolsas';
  if (porUnidad(p)) return n === 1 ? 'pieza' : 'piezas';
  return n === 1 ? 'botella' : 'botellas';
}
/** Título de la existencia: Botellas en el granel líquido; lo demás, Cant. (la unidad ya la dice la cantidad). */
function tituloExistencia(p) {
  return esGranelLiquido(p) ? 'Botellas' : 'Cant.';
}
/** Medidas contadas en la unidad del producto, por partes ("9 botellas", "1 medida"; las bolsas, en piezas). */
function partesExistencia(p, medidas) {
  if (p.clase === 'bolsa') {
    const n = Math.max(0, Math.round(Number(medidas) || 0));
    return [`${n} ${unidadVenta(p, n)}`];
  }
  const { botellas, medidas: sueltas } = desglosarBotellas(Math.max(0, Number(medidas) || 0), p);
  const partes = [];
  // "0 botellas" solo si no hay nada más que decir (como el reporte diario).
  if (botellas > 0 || sueltas === 0) partes.push(`${botellas} ${unidadVenta(p, botellas)}`);
  if (sueltas > 0) partes.push(plural(sueltas, 'medida', 'medidas'));
  return partes;
}
/**
 * Medidas apartadas en notas abiertas: siguen en el estante pero ya tienen
 * dueño. El semáforo se calcula con lo disponible, por eso se muestra.
 */
function medidasApartadas(p) {
  return Math.max(0, Math.round(Number(p.stock_reservado) || 0));
}
function partesApartadas(p) {
  return partesExistencia(p, medidasApartadas(p));
}
function textoApartadas(p) {
  return partesApartadas(p).join(' y ');
}
/** Lo que se puede vender hoy: existencia menos lo apartado. */
function partesDisponible(p) {
  return partesExistencia(p, (Number(p.stock_actual) || 0) - medidasApartadas(p));
}
function textoDisponible(p) {
  return partesDisponible(p).join(' y ');
}
/** El granel en bidones (con las botellas sueltas de remanente), por partes. */
function partesGranel(p) {
  if (!esGranelLiquido(p)) return [];
  const { bidones, botellas } = desglosarBidones(p.stock_granel_medidas, p);
  const partes = [plural(bidones, 'bidón', 'bidones')];
  if (botellas > 0) partes.push(plural(botellas, 'botella', 'botellas'));
  return partes;
}
/** Partes unidas con "y"; si no caben, se parten entre una y otra, nunca a media parte. */
function Partes({ partes }) {
  /* El espacio va fuera del nowrap: ahí es donde se puede partir el renglón. */
  return partes.map((t, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="whitespace-nowrap">{t}{i < partes.length - 1 && ' y'}</span>
    </Fragment>
  ));
}
function precioTxt(v) {
  return v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '—';
}
/** Nombre de la bolsa según su tamaño de catálogo (todas se llaman "Bolsa"). */
function nombreBolsa(p) {
  return p.tamano_bolsa || null;
}
/**
 * Título del producto: la marca en los de marca, el nombre en el granel y el
 * tamaño en las bolsas ("Bolsa" baja al subtítulo).
 */
function tituloProd(p) {
  if (p.clase === 'bolsa') return nombreBolsa(p) ?? p.nombre;
  return p.tipo_liquido === 'marca' && p.marca ? p.marca : p.nombre;
}
function subtituloProd(p) {
  if (p.clase === 'bolsa') return nombreBolsa(p) ? 'Bolsa' : null;
  if (esPolvo(p)) return 'Polvo';
  return p.tipo_liquido === 'marca' && p.marca ? p.nombre : null;
}
/** Orden: granel, marca y bolsas; dentro de cada grupo, por nombre. */
function ordenProd(a, b) {
  const rank = (p) => (p.clase === 'bolsa' ? 2 : p.tipo_liquido === 'granel' ? 0 : 1);
  const r = rank(a) - rank(b);
  return r !== 0 ? r : a.nombre.localeCompare(b.nombre);
}
/** Unidad para los avisos: las bolsas con su tamaño ("bolsas chicas"). */
function unidadAviso(p) {
  if (p.clase === 'bolsa') {
    const t = { chica: 'chicas', grande: 'grandes', jumbo: 'jumbo' }[p.tamano_bolsa?.toLowerCase()] ?? '';
    return `bolsas ${t}`.trim();
  }
  return unidadVenta(p);
}
/** Mensajes de aviso de existencia, contando lo disponible (lo que decide el semáforo). */
function mensajeAvisoBotellas(p) {
  if (p.estado_stock === 'agotado') {
    return medidasApartadas(p) > 0
      ? `No quedan ${unidadAviso(p)} libres — apartadas en notas: ${textoApartadas(p)}`
      : `Se acabaron las ${unidadAviso(p)}`;
  }
  const apartadas = medidasApartadas(p) > 0 ? ` · apartadas en notas: ${textoApartadas(p)}` : '';
  return `Están por acabarse las ${unidadAviso(p)} — disponibles: ${textoDisponible(p)}${apartadas}`;
}
function mensajeAvisoGranel(p) {
  if (p.estado_granel === 'agotado') return 'Se acabaron los bidones';
  const { bidones } = desglosarBidones(p.stock_granel_medidas, p);
  return `Están por acabarse los bidones — hay ${bidones} actualmente`;
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
  // Granel: líquido (bidón, botellas y medidas) o en polvo (unidades sueltas).
  forma:             'liquido',
  metodo_medida:       'medidas',   // 'medidas' (medidas por botella) | 'ml' (tamaño de la medida)
  medida_ml:           '',
  medidas_por_botella: '',
  precio_medida:          '',
  precio_botella:       '',
  stock_minimo_botellas: '0',   // el aviso se captura en botellas; se guarda en medidas
  stock_minimo_bidones:  '0',   // aviso del granel, en bidones; se guarda en medidas
  // Tamaño del catálogo: arranca vacío para obligar a elegirlo.
  tamano_bolsa:      '',
  // Cómo se surte: 'rollo' (y cuántas trae) o 'pieza'. Arranca vacío.
  compra_bolsa:      '',
  bolsas_por_rollo:  '',
  // Servicios Por Encargo donde la bolsa se agrega sola; vacío = se vende a mano.
  servicios_bolsa:   [],
  stock_minimo_bolsas: '0',
  // Tipo de granel líquido (Jabón, Suavizante…); vacío = sin tipo.
  tipo_granel_id:    '',
};

/** Servicios Por Encargo a los que se puede ligar una bolsa: [valor, etiqueta]. */
const SERVICIOS_BOLSA = [['chico', 'Chico'], ['mediano', 'Mediano'], ['grande', 'Grande'], ['edredon', 'Edredón']];

// ── Modal crear / editar ────────────────────────────────────────
function ModalProducto({ producto, onClose, onGuardado, marcas = [], graneles = [], tamanosBolsa = [], tiposGranel = [] }) {
  const esEdicion = Boolean(producto);
  const [form, setForm] = useState(producto
    ? {
        nombre:         producto.nombre,
        marca:          producto.marca ?? '',
        tipo_liquido:   producto.clase === 'bolsa' ? 'bolsa' : (producto.tipo_liquido ?? 'granel'),
        envase:         producto.envase ?? 'Bidón',
        forma:          producto.forma ?? 'liquido',
        tamano_bolsa:   producto.tamano_bolsa ?? '',
        // Sin bolsas por rollo guardadas, la bolsa se compra suelta.
        compra_bolsa:   producto.clase === 'bolsa' ? (producto.bolsas_por_rollo ? 'rollo' : 'pieza') : '',
        bolsas_por_rollo: producto.bolsas_por_rollo ?? '',
        servicios_bolsa: producto.servicios_bolsa ?? [],
        tipo_granel_id:  producto.tipo_granel_id != null ? String(producto.tipo_granel_id) : '',
        stock_minimo_bolsas: producto.clase === 'bolsa' ? String(producto.stock_minimo ?? 0) : '0',
        bidon_valor:    producto.volumen_envase_ml
          ? (producto.volumen_envase_ml % 1000 === 0 ? String(producto.volumen_envase_ml / 1000) : String(producto.volumen_envase_ml))
          : '',
        bidon_unidad:   producto.volumen_envase_ml && producto.volumen_envase_ml % 1000 !== 0 ? 'Mililitros' : 'Litros',
        botella_ml:        producto.botella_ml ?? '',
        metodo_medida:       'ml',
        medida_ml:           producto.medida_ml ?? '',
        medidas_por_botella: '',
        precio_medida:       producto.precio_unitario ?? '',
        precio_botella:    producto.clase === 'bolsa' ? (producto.precio_unitario ?? '') : (producto.precio_botella ?? ''),
        // El mínimo se guarda en medidas; en el formulario se muestra en botellas.
        stock_minimo_botellas: medidasPorBotella(producto) > 0
          ? String(Math.round(Number(producto.stock_minimo ?? 0) / medidasPorBotella(producto)))
          : String(producto.stock_minimo ?? 0),
        // El mínimo del granel se guarda en medidas; se muestra en bidones.
        stock_minimo_bidones: medidasPorBidon(producto) > 0
          ? String(Math.round(Number(producto.stock_minimo_granel ?? 0) / medidasPorBidon(producto)))
          : '0',
      }
    : FORM_VACIO
  );
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const esGranel = form.tipo_liquido === 'granel';
  const esBolsa  = form.tipo_liquido === 'bolsa';

  // Un botón por servicio Por Encargo; `campo` es la lista del form que marcan.
  const botonesServicios = (campo) => (
    <div className="flex gap-2">
      {SERVICIOS_BOLSA.map(([val, label]) => {
        const marcado = form[campo].includes(val);
        return (
          <button
            key={val} type="button" aria-pressed={marcado}
            onClick={() => setForm(f => ({
              ...f,
              [campo]: marcado ? f[campo].filter(x => x !== val) : [...f[campo], val],
            }))}
            className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
              marcado ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {marcado && <span className="mr-1">✓</span>}{label}
          </button>
        );
      })}
    </div>
  );
  const esMarca  = form.tipo_liquido === 'marca';
  // El polvo se cuenta por unidades: sin bidón, botella ni medida que capturar.
  const esPolvoForm  = esGranel && form.forma === 'polvo';
  const esGranelLiq  = esGranel && !esPolvoForm;

  // Cálculos en vivo para mostrar el rendimiento.
  const botellaMl = Number(form.botella_ml) || 0;
  const bidonMl   = aMl(form.bidon_valor, form.bidon_unidad);
  const medidaMl    = Number(form.medida_ml) || 0;
  // Rendimiento: por tamaño de medida (mL) o por medidas por botella (directo).
  const medidasBotella = form.metodo_medida === 'ml'
    ? (medidaMl > 0 ? Math.floor(botellaMl / medidaMl) : 0)
    : (Number(form.medidas_por_botella) || 0);
  const botellasBidon = botellaMl > 0 ? Math.floor(bidonMl / botellaMl) : 0;
  const medidasBidon = botellasBidon * medidasBotella;

  const marcaOptions = form.marca && !marcas.includes(form.marca) ? [form.marca, ...marcas] : marcas;
  // Si el nombre o el tamaño ya no está en el catálogo pero es del producto que
  // se edita, se sigue ofreciendo para no borrárselo.
  const granelOptions = form.nombre && !graneles.includes(form.nombre)
    ? [form.nombre, ...graneles] : graneles;
  // Se empata con el catálogo sin distinguir mayúsculas.
  const bolsaOptions = tamanosBolsa.map(n => ({ v: n, label: n }));
  const bolsaElegida = bolsaOptions.find(
    o => o.v.toLowerCase() === form.tamano_bolsa.toLowerCase()
  )?.v ?? form.tamano_bolsa;
  const bolsaFuera = form.tamano_bolsa && !bolsaOptions.some(o => o.v === bolsaElegida);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Los botones no pasan por la validación del navegador: se revisa aquí.
    if (esBolsa && !form.compra_bolsa) {
      setError('Indica si la bolsa se compra por rollo o por pieza.');
      return;
    }
    setError('');
    if (!esEdicion && !confirmar) { setConfirmar(true); return; }
    ejecutarGuardado();
  };

  const ejecutarGuardado = async () => {
    setError('');
    setLoading(true);

    // Bolsa: producto simple contado en piezas (precio por pieza).
    if (esBolsa) {
      const bodyBolsa = {
        clase:            'bolsa',
        nombre:           'Bolsa',
        tamano_bolsa:     form.tamano_bolsa,
        // Por pieza, null (es lo que distingue a una bolsa suelta).
        bolsas_por_rollo: form.compra_bolsa === 'rollo' ? (Number(form.bolsas_por_rollo) || null) : null,
        servicios_bolsa:  form.servicios_bolsa,
        precio_unitario:  form.precio_botella !== '' ? Number(form.precio_botella) : null,
        stock_minimo:     Number(form.stock_minimo_bolsas) || 0,
      };
      try {
        const resultado = esEdicion
          ? await api.put(`/productos/${producto.id}`, bodyBolsa)
          : await api.post('/productos', bodyBolsa);
        onGuardado(resultado, esEdicion);
      } catch (err) {
        setError(err.message);
        setConfirmar(false);
      } finally {
        setLoading(false);
      }
      return;
    }

    const body = {
      clase:             'liquido',
      nombre:            form.nombre.trim(),
      marca:             esGranel ? null : (form.marca || null),
      tipo_liquido:      form.tipo_liquido,
      forma:             esGranel ? form.forma : 'liquido',
      unidad:            'Medidas',
      envase:            esGranelLiq ? 'Bidón' : null,
      // El precio por medida (Por Encargo) solo aplica al granel líquido.
      precio_unitario:   esGranelLiq && form.precio_medida !== '' ? Number(form.precio_medida) : null,
      precio_botella:    form.precio_botella !== '' ? Number(form.precio_botella) : null,
      volumen_envase_ml: esGranelLiq && bidonMl > 0 ? bidonMl : null,
      // Marca y polvo: por unidad entera (1 unidad = 1 botella = 1 medida).
      botella_ml:        esGranelLiq ? (botellaMl > 0 ? botellaMl : null) : 1,
      medida_ml:           esGranelLiq
        ? (form.metodo_medida === 'ml' && medidaMl > 0 ? medidaMl : null)
        : 1,
      medidas_por_botella: esGranelLiq && form.metodo_medida === 'medidas' ? (Number(form.medidas_por_botella) || null) : null,
      // Con su tipo, los servicios Por Encargo lo ofrecen en Salidas.
      tipo_granel_id:    esGranelLiq && form.tipo_granel_id !== '' ? Number(form.tipo_granel_id) : null,
      // El aviso se captura en botellas y se guarda en medidas.
      stock_minimo:      medidasBotella > 0
        ? Math.round((Number(form.stock_minimo_botellas) || 0) * medidasBotella)
        : (Number(form.stock_minimo_botellas) || 0),
      // El aviso del granel se captura en bidones y se guarda en medidas.
      stock_minimo_granel: esGranelLiq
        ? (medidasBidon > 0
            ? Math.round((Number(form.stock_minimo_bidones) || 0) * medidasBidon)
            : (Number(form.stock_minimo_bidones) || 0))
        : 0,
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
          {/* Tipo de producto */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tipo de producto <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {[['granel', 'Granel', 'Se rellena desde un envase'], ['marca', 'De marca', 'Se compra embotellado'], ['bolsa', 'Bolsa', 'Por rollo o por pieza']].map(([val, label, hint]) => (
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

          {/* Nombre (las bolsas se llaman "Bolsa"). El granel lo elige de su catálogo,
              para no tener nombres distintos para lo mismo; el de marca lo escribe. */}
          {!esBolsa && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Nombre <span className="text-red-500">*</span>
              </label>
              {esGranel ? (
                <>
                  <Selector
                    claseCampo={INPUT_CLS}
                    requerido
                    valor={form.nombre}
                    onChange={v => handleChange({ target: { name: 'nombre', value: v } })}
                    titulo="Granel"
                    opciones={granelOptions.map(g => ({ valor: g, etiqueta: g }))}
                  />
                  {granelOptions.length === 0 && (
                    <p className="text-sm text-gray-400 mt-1">
                      Todavía no hay graneles. Se agregan en Ajustes → Inventario.
                    </p>
                  )}
                </>
              ) : (
                <input
                  type="text" name="nombre" required
                  value={form.nombre} onChange={handleChange}
                  placeholder="Ej. Suavizante" className={INPUT_CLS}
                />
              )}
            </div>
          )}

          {/* Granel: líquido o en polvo (por piezas enteras). */}
          {esGranel && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                ¿Qué tipo es? <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {[['liquido', 'Líquido', 'Se sirve por medidas'], ['polvo', 'Polvo', 'Se vende por piezas']].map(([val, label, hint]) => (
                  <button
                    key={val} type="button"
                    onClick={() => setForm(f => ({ ...f, forma: val }))}
                    className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                      form.forma === val ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block">{label}</span>
                    <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tipo de granel (solo líquido): con él los servicios lo ofrecen en Salidas.
              Uno desactivado se sigue mostrando si el producto ya lo tiene. */}
          {esGranelLiq && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Tipo de granel
              </label>
              <Selector
                claseCampo={INPUT_CLS}
                valor={form.tipo_granel_id}
                onChange={v => handleChange({ target: { name: 'tipo_granel_id', value: v } })}
                titulo="Tipo de granel"
                opciones={[
                  { valor: '', etiqueta: 'Sin tipo' },
                  ...tiposGranel
                    .filter(t => t.activo || String(t.id) === form.tipo_granel_id)
                    .map(t => ({ valor: String(t.id), etiqueta: t.nombre })),
                ]}
              />
              <p className="text-sm text-gray-400 mt-1">
                {form.tipo_granel_id === ''
                  ? 'Sin tipo no se ofrece en los servicios Por Encargo. Los tipos se administran en Ajustes → Inventario.'
                  : 'Los servicios Por Encargo lo ofrecen en Salidas junto con los demás de este tipo.'}
              </p>
            </div>
          )}

          {/* Marca (solo productos de marca) */}
          {esMarca && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Marca <span className="text-red-500">*</span>
              </label>
              <Selector
                claseCampo={INPUT_CLS}
                requerido
                valor={form.marca}
                onChange={v => handleChange({ target: { name: 'marca', value: v } })}
                titulo="Marca"
                opciones={marcaOptions.map(c => ({ valor: c, etiqueta: c }))}
              />
            </div>
          )}

          {/* Bolsa: tamaño y bolsas por rollo */}
          {esBolsa && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Tamaño <span className="text-red-500">*</span>
                </label>
                <Selector
                  claseCampo={INPUT_CLS}
                  requerido
                  valor={bolsaElegida}
                  onChange={v => handleChange({ target: { name: 'tamano_bolsa', value: v } })}
                  titulo="Tamaño de bolsa"
                  opciones={[
                    ...(bolsaFuera ? [{ valor: form.tamano_bolsa, etiqueta: form.tamano_bolsa }] : []),
                    ...bolsaOptions.map(o => ({ valor: o.v, etiqueta: o.label })),
                  ]}
                />
                {bolsaOptions.length === 0 && (
                  <p className="text-sm text-gray-400 mt-1">
                    Todavía no hay tamaños de bolsa. Se agregan en Ajustes → Inventario.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  ¿Cómo se compra? <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {[['rollo', 'Por rollo', 'Cada rollo trae varias'], ['pieza', 'Por piezas', 'Bolsas sueltas']].map(([val, label, hint]) => (
                    <button
                      key={val} type="button"
                      onClick={() => setForm(f => ({ ...f, compra_bolsa: val }))}
                      className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                        form.compra_bolsa === val ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block">{label}</span>
                      <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  ¿A qué servicios va ligada?
                </label>
                {botonesServicios('servicios_bolsa')}
                <p className="text-sm text-gray-400 mt-1">
                  {form.servicios_bolsa.length === 0
                    ? 'Sin servicio no se agrega sola: se vende a mano.'
                    : 'En Por Encargo, la nota la agrega sola a cada carga de esos servicios, tantas como diga el servicio en Ajustes.'}
                </p>
              </div>
              {form.compra_bolsa === 'rollo' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    ¿Cuántas bolsas trae un rollo? <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" inputMode="numeric" name="bolsas_por_rollo" min="1" step="1" required
                    value={form.bolsas_por_rollo} onChange={handleChange} placeholder="Ej. 100"
                    className={NUM_CLS}
                  />
                </div>
              )}
            </>
          )}

          {/* Volúmenes (solo el granel líquido: el polvo no tiene bidón) */}
          <div className="space-y-3">
            {esGranelLiq && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1.5">
                  ¿Cuánto trae el bidón? <span className="text-red-500">*</span>
                </p>
                <div className="flex gap-2">
                  <input
                    type="number" inputMode="decimal" name="bidon_valor" min="0" step="any" required
                    value={form.bidon_valor} onChange={handleChange} placeholder="Ej. 20"
                    className={`${NUM_CLS} flex-1 min-w-0`}
                  />
                  <Selector
                    className="w-28 flex-shrink-0"
                    claseCampo="w-full px-3 py-3.5 border border-gray-300 rounded-lg text-base"
                    valor={form.bidon_unidad}
                    onChange={v => handleChange({ target: { name: 'bidon_unidad', value: v } })}
                    titulo="Unidad"
                    opciones={UNIDADES_VOLUMEN.map(u => ({ valor: u, etiqueta: u }))}
                  />
                </div>
              </div>
            )}
            {/* Con existencia o algo apartado, los tamaños no se pueden cambiar: se
                avisa antes de guardar. */}
            {esEdicion && (Number(producto?.stock_actual) > 0 || Number(producto?.stock_granel_medidas) > 0
              || Number(producto?.stock_reservado) > 0) && (
              <p className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Este producto tiene existencia: sus tamaños y su tipo no se pueden cambiar. Para corregirlos,
                registra una salida de todo, edítalo y vuelve a dar entrada.
              </p>
            )}
            {esGranelLiq && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1.5">
                  ¿De qué tamaño es la botella? (mL) <span className="text-red-500">*</span>
                </p>
                <input
                  type="number" inputMode="decimal" name="botella_ml" min="1" step="any" required
                  value={form.botella_ml} onChange={handleChange} placeholder="Ej. 800"
                  className={NUM_CLS}
                />
              </div>
            )}
            {/* El rendimiento por medida solo aplica al granel líquido. */}
            {esGranelLiq && (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">
                    Rendimiento de la medida <span className="text-red-500">*</span>
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, metodo_medida: 'medidas' }))}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        form.metodo_medida === 'medidas' ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Medidas por botella
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, metodo_medida: 'ml' }))}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        form.metodo_medida === 'ml' ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Tamaño de medida (mL)
                    </button>
                  </div>
                  {form.metodo_medida === 'ml' ? (
                    <input
                      type="number" inputMode="decimal" name="medida_ml" min="1" step="any" required
                      value={form.medida_ml} onChange={handleChange} placeholder="Ej. 200 mL"
                      className={NUM_CLS}
                    />
                  ) : (
                    <>
                      <input
                        type="number" inputMode="numeric" name="medidas_por_botella" min="1" step="1" required
                        value={form.medidas_por_botella} onChange={handleChange} placeholder="Ej. 2 medidas por botella"
                        className={NUM_CLS}
                      />
                      <p className="text-[11px] text-gray-400 mt-1">
                        Aproximado: cuántas medidas salen de una botella.
                      </p>
                    </>
                  )}
                </div>
                {/* Rendimiento calculado */}
                <div className={`rounded-lg px-4 py-3 text-sm ${medidasBotella > 0 ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'}`}>
                  {medidasBotella > 0 ? (
                    <>
                      Rinde <span className="font-bold">{medidasBotella} medidas</span> por botella
                      {botellasBidon > 0 && <> · <span className="font-bold">{botellasBidon} botellas</span> por bidón</>}.
                    </>
                  ) : 'Captura los tamaños de botella y medida para calcular el rendimiento.'}
                </div>
              </>
            )}
          </div>

          {/* Precios. El precio por medida (Por Encargo) solo aplica a granel. */}
          <div className={esGranelLiq ? 'grid grid-cols-2 gap-3' : ''}>
            {esGranelLiq && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Precio por medida ($)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                  <input
                    type="number" inputMode="decimal" name="precio_medida" min="0" step="any"
                    value={form.precio_medida} onChange={handleChange} placeholder="0.00"
                    className={`${NUM_CLS} pl-7`}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Por Encargo</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {esGranelLiq ? 'Precio por botella ($)' : 'Precio por pieza ($)'}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-base">$</span>
                <input
                  type="number" inputMode="decimal" name="precio_botella" min="0" step="any"
                  value={form.precio_botella} onChange={handleChange} placeholder="0.00"
                  className={`${NUM_CLS} pl-7`}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{esBolsa ? 'Se cobra en la nota' : 'Autoservicio'}</p>
            </div>
          </div>

          {/* La existencia se carga con una Entrada, no al dar de alta. */}

          {/* Alerta de stock bajo */}
          {esBolsa ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Avisar cuando queden (bolsas)
              </label>
              <input
                type="number" inputMode="numeric" name="stock_minimo_bolsas" min="0" step="1"
                value={form.stock_minimo_bolsas} onChange={handleChange} placeholder="Ej. 20"
                className={NUM_CLS}
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Avisar cuando queden ({esGranelLiq ? 'botellas' : 'piezas'})
              </label>
              <input
                type="number" inputMode="numeric" name="stock_minimo_botellas" min="0" step="1"
                value={form.stock_minimo_botellas} onChange={handleChange} placeholder="Ej. 5"
                className={NUM_CLS}
              />
            </div>
          )}

          {/* Alerta de granel bajo (bidones) */}
          {esGranelLiq && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Avisar cuando queden (bidones)
              </label>
              <input
                type="number" inputMode="numeric" name="stock_minimo_bidones" min="0" step="1"
                value={form.stock_minimo_bidones} onChange={handleChange} placeholder="Ej. 1"
                className={NUM_CLS}
              />
            </div>
          )}

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
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
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
  const esGranel = esGranelLiquido(producto);
  const esBolsa  = producto.clase === 'bolsa';
  const [destino, setDestino] = useState(esGranel ? 'granel' : esBolsa ? 'piezas' : 'botellas');
  // Bolsas: por rollo o por pieza (las que se compran sueltas, solo pieza).
  const porRollo = Number(producto.bolsas_por_rollo) > 0;
  const [unidadBolsa, setUnidadBolsa] = useState(porRollo ? 'rollo' : 'pieza');
  const [cantidad, setCantidad] = useState('');
  // Motivo libre de la salida (opcional).
  const [nota, setNota] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const esEntrada = tipo === 'entrada';
  // Unidad: bolsas = rollo/pieza; granel = bidones/botellas por destino; marca = botella.
  const unidad = esBolsa ? unidadBolsa : (destino === 'granel' ? 'bidon' : 'botella');
  const unidadTxt = esBolsa
    ? (unidadBolsa === 'rollo' ? 'rollos' : 'bolsas')
    : (destino === 'granel' ? 'bidones' : unidadVenta(producto));

  const enviar = async () => {
    setError('');
    setLoading(true);
    try {
      const resp = await api.post(`/productos/${producto.id}/movimiento`, {
        tipo, destino, unidad, cantidad: Number(cantidad),
        ...(!esEntrada && nota.trim() && { nota: nota.trim() }),
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

        {/* Destino (solo granel puede elegir entre bidones y botellas) */}
        {esGranel && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">¿A qué existencia?</label>
            <div className="flex gap-2">
              {[['granel', 'Bidones'], ['botellas', 'Botellas']].map(([val, label]) => (
                <button
                  key={val} type="button" onClick={() => setDestino(val)}
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

        {/* Bolsas: elegir si la cantidad es por rollo o por pieza */}
        {esBolsa && porRollo && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">¿Por rollo o por pieza?</label>
            <div className="flex gap-2">
              {[['rollo', 'Rollos'], ['pieza', 'Piezas']].map(([val, label]) => (
                <button
                  key={val} type="button" onClick={() => setUnidadBolsa(val)}
                  className={`flex-1 py-2.5 px-2 rounded-lg border text-sm font-medium transition-colors ${
                    unidadBolsa === val ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Cantidad ({unidadTxt})</label>
          <input
            type="number" inputMode="decimal" min="0" step="any" value={cantidad} placeholder="0"
            onChange={(e) => setCantidad(e.target.value)} className={NUM_CLS}
          />
        </div>

        {!esEntrada && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota</label>
            <textarea
              value={nota} maxLength={1000} rows={4}
              onChange={(e) => setNota(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base resize-y focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
            />
          </div>
        )}

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
  const tpb = medidasPorBotella(producto);
  const maxBotellas = tpb > 0 ? Math.floor(Number(producto.stock_granel_medidas) / tpb) : 0;
  // Vacío: se rellena lo que de verdad se rellenó.
  const [botellas, setBotellas] = useState('');
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-modal overflow-y-auto p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Rellenar botellas</h3>
          <p className="text-sm text-gray-500 mt-0.5">{producto.nombre}</p>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
          A granel disponible: <span className="font-semibold text-gray-800"><Partes partes={partesGranel(producto)} /></span>
          <br />Alcanza para <span className="font-semibold text-gray-800">{maxBotellas} botella(s)</span>.
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ¿Cuántas botellas rellenaste?
          </label>
          <input
            type="number" inputMode="numeric" min="1" max={maxBotellas} step="1" value={botellas} placeholder="0"
            onChange={(e) => setBotellas(e.target.value)} className={NUM_CLS}
          />
          {n > 0 && !invalido && (
            <p className="text-sm text-gray-500 mt-1">
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
                      <span className="text-sm font-medium text-gray-800">{m.descripcion ?? `${m.cantidad_medidas} medidas`}</span>
                    </div>
                    <p className="text-sm text-gray-400 mt-0.5">
                      {m.destino === 'granel' ? 'A granel' : 'Botellas'}
                      {m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}
                    </p>
                    {/* Motivo de la salida manual. */}
                    {m.nota && <p className="text-sm text-gray-500 mt-0.5 whitespace-pre-line">Nota: {m.nota}</p>}
                  </div>
                  <span className="text-sm text-gray-400 flex-shrink-0 whitespace-nowrap">{fechaHoraCorta(m.created_at)}</span>
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
            <h3 className="text-base font-semibold text-gray-900">Desactivar producto</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-medium text-gray-700">{producto.nombre}</span> se ocultará del inventario y de Nueva Nota.
              Las notas anteriores no se ven afectadas y puedes reactivarlo cuando quieras.
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
            {loading ? 'Desactivando...' : 'Desactivar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Íconos ─────────────────────────────────────────────────────
/**
 * Botón ⋮ con Editar, Desactivar y Eliminar: fuera de la vista principal para
 * que no se toquen sin querer. Desactivar y Eliminar piden confirmación.
 */
function MenuOpcionesProducto({ onEditar, onDesactivar, onEliminar }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('touchstart', fuera);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('touchstart', fuera);
    };
  }, [abierto]);

  const OPCION_CLS = 'w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Más opciones"
        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 mt-1 z-10 w-52 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <button type="button" role="menuitem" onClick={() => { setAbierto(false); onEditar(); }}
            className={`${OPCION_CLS} text-gray-700 hover:bg-gray-50`}>
            <IconoLapiz />
            Editar
          </button>
          <button type="button" role="menuitem" onClick={() => { setAbierto(false); onDesactivar(); }}
            className={`${OPCION_CLS} text-amber-700 hover:bg-amber-50`}>
            <IconoArchivar />
            Desactivar
          </button>
          {/* Separado del resto: es lo único que no se puede deshacer. */}
          <button type="button" role="menuitem" onClick={() => { setAbierto(false); onEliminar(); }}
            className={`${OPCION_CLS} text-red-600 hover:bg-red-50 border-t border-gray-100`}>
            <IconoBasura />
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

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

/** Categoría del producto para los filtros. */
function categoriaProd(p) {
  if (p.clase === 'bolsa') return 'bolsa';
  return p.tipo_liquido === 'marca' ? 'marca' : 'granel';
}
/** Filtros de la lista, con el estilo de los de Gestión de máquinas. */
const FILTRO_CFG = {
  granel:       { label: 'Granel',       cls: 'bg-light-blue text-blue',      clsActive: 'bg-blue text-white',       dot: 'bg-blue' },
  marca:        { label: 'Marca',        cls: 'bg-purple-100 text-purple-700', clsActive: 'bg-purple-600 text-white', dot: 'bg-purple-500' },
  bolsa:        { label: 'Bolsa',        cls: 'bg-amber-100 text-amber-700',  clsActive: 'bg-amber-500 text-white',  dot: 'bg-amber-500' },
  desactivados: { label: 'Desactivados', cls: 'bg-gray-100 text-gray-600',    clsActive: 'bg-gray-600 text-white',   dot: 'bg-gray-400' },
};

/** Color del texto del chip de tipo, para pintar el nombre igual. */
function colorTextoTipo(p) {
  if (p.clase === 'bolsa') return 'text-amber-700';
  if (p.tipo_liquido === 'granel') return 'text-blue';
  if (p.tipo_liquido === 'marca') return 'text-purple-700';
  return 'text-gray-800';
}
// Chip de tipo de producto (granel / marca / bolsa).
function ChipTipo({ p }) {
  const cfg = p.clase === 'bolsa'
    ? { label: 'Bolsa', cls: 'bg-amber-100 text-amber-700' }
    : p.tipo_liquido === 'granel' ? { label: 'Granel', cls: 'bg-light-blue text-blue' }
    : p.tipo_liquido === 'marca'  ? { label: 'Marca',  cls: 'bg-purple-100 text-purple-700' }
    : null;
  if (!cfg) return null;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

function BadgeEstado({ estado }) {
  if (estado === 'agotado') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Agotado</span>;
  if (estado === 'por_agotarse') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Por agotarse</span>;
  return null;
}

/** Punto naranja de las listas: el producto tiene algo apartado en notas. */
function PuntoApartado() {
  /* Centrado en la primera línea: si el texto baja de renglón, el punto no se va solo. */
  return (
    <span className="h-[1lh] flex items-center flex-shrink-0">
      <span className="w-2 h-2 rounded-full bg-orange-500" />
    </span>
  );
}

// Badge del granel (bidón). Solo se dibuja algo cuando está por acabarse o agotado.
function BadgeGranel({ estado }) {
  if (estado === 'agotado') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Sin bidones</span>;
  if (estado === 'por_agotarse') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Por acabarse</span>;
  return null;
}

// ── Página principal ────────────────────────────────────────────
/** Hoy en YYYY-MM-DD (zona local del navegador). */
function hoyISO() {
  return new Date().toLocaleDateString('en-CA');
}
/** "Lunes, 03 de Agosto de 2026" a partir de 'YYYY-MM-DD'. */
function fechaLegible(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const s = dt.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Pestaña "Reporte diario" (solo admin) ───────────────────────

/** 'YYYY-MM-DD' → Date local (new Date(iso) correría un día). */
function fechaLocalISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Celda de Entradas o Salidas: con movimiento es un botón que abre el detalle.
 * `hayAlgo` la vuelve botón aunque el neto sea guion (una devolución).
 */
function CeldaMovimiento({ lineas, hayAlgo = false, onClick }) {
  const vacia = lineas.length === 1 && lineas[0] === '—';
  if (vacia && !hayAlgo) return <span className="block text-gray-400">—</span>;
  return (
    <button type="button" onClick={onClick}
      className="text-left text-blue hover:text-blue-700 hover:underline underline-offset-2 transition-colors">
      {lineas.map((l, i) => (
        <span key={i} className={`block ${l === '—' ? 'text-gray-400' : ''}`}>{l}</span>
      ))}
    </button>
  );
}

/** Rellenar: en Entradas, las botellas llenadas; en Salidas, lo que bajó el bidón. */
function enBidon(m, tipo) {
  return m.tipo === 'rellenar' ? tipo === 'salidas' : m.destino === 'granel';
}

function cantidadMovimiento(m, p, esMarca, tipo) {
  const n = Number(m.cantidad_medidas) || 0;
  if (esMarca) return textoBotellas(n, p.medidas_por_botella, { marca: true });
  if (enBidon(m, tipo)) return `A granel: ${textoGranelFmt(n, p.medidas_por_bidon, p.medidas_por_botella)}`;
  return textoBotellas(n, p.medidas_por_botella);
}

const TITULO_MOVIMIENTOS = { entradas: 'Entradas', salidas: 'Salidas', devueltos: 'Devuelto' };

/** Entradas o salidas de un producto en un día: quién, a qué hora y cuánto (con enlace a su nota). */
function MovimientosDiaModal({ producto, tipo, fecha, onClose }) {
  const navigate = useNavigate();
  const [movs, setMovs] = useState(null);
  // Movimiento con la nota desplegada (solo uno a la vez).
  const [notaAbierta, setNotaAbierta] = useState(null);
  const [error, setError] = useState('');
  const esMarca = porUnidad(producto);

  useEffect(() => {
    let activo = true;
    api.get(`/productos/${producto.id}/movimientos?fecha=${fecha}&tipo=${tipo}`)
      .then(d => { if (activo) setMovs(d ?? []); })
      .catch(e => { if (activo) setError(e.message); });
    return () => { activo = false; };
  }, [producto.id, tipo, fecha]);

  const nombre = esMarca && producto.marca ? `${producto.marca} · ${producto.nombre}` : producto.nombre;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{TITULO_MOVIMIENTOS[tipo] ?? 'Movimientos'}</h3>
            <p className="text-sm text-gray-500 truncate">{nombre} · {fechaLarga(fechaLocalISO(fecha))}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {error ? (
            <p className="text-center text-red-600 text-sm py-10 px-5">{error}</p>
          ) : movs == null ? (
            <p className="text-center text-gray-400 text-sm py-10">Cargando…</p>
          ) : movs.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Sin movimientos</p>
          ) : movs.map(m => {
            // Título: quién y a qué hora; si vino de una nota, la nota (y lo otro baja a
            // subtítulo). Una salida manual con motivo tiene su botón "Nota".
            const abierta = notaAbierta === m.id;
            const deNota = m.tipo === 'venta' || m.tipo === 'liberacion';
            const irANota = m.nota_id && m.nota_folio ? () => { onClose(); navigate(`/notas/${m.nota_id}`); } : null;
            const quienHora = `${m.usuario_nombre || 'Usuario eliminado'} · ${formatHora12(m.created_at)}`;
            // Lo devuelto dice qué nota se anuló: si se canceló, lleva a ella; si se borró,
            // queda su folio.
            const tituloNota = m.tipo === 'liberacion'
              ? (m.nota_folio
                  ? `Nota ${m.nota_folio} anulada${irANota ? '' : ' (se eliminó)'}`
                  : 'Nota anulada')
              : (m.nota_folio
                  ? `Nota ${m.nota_folio}${irANota ? '' : ' (se eliminó)'}`
                  : 'Venta en nota');
            return (
              <div key={m.id} className="px-5 py-2.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  {deNota ? (
                    <div className="min-w-0">
                      {irANota ? (
                        <button type="button" onClick={irANota}
                          className="block max-w-full text-sm font-medium text-blue hover:underline underline-offset-2 truncate text-left">
                          {tituloNota}
                        </button>
                      ) : (
                        <p className="text-sm text-gray-800 truncate">{tituloNota}</p>
                      )}
                      <p className="text-sm text-gray-400 truncate">{quienHora}</p>
                    </div>
                  ) : (
                    <div className="min-w-0 flex items-center gap-2">
                      <p className="min-w-0 text-sm text-gray-800 truncate">{quienHora}</p>
                      {m.nota && (
                        <button
                          type="button"
                          onClick={() => setNotaAbierta(abierta ? null : m.id)}
                          aria-expanded={abierta}
                          className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border transition-colors ${
                            abierta ? 'border-blue bg-light-blue text-blue' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          Nota
                        </button>
                      )}
                    </div>
                  )}
                  <span className={`text-sm font-medium whitespace-nowrap ${
                    m.tipo === 'liberacion' ? 'text-green-700' : m.tipo === 'rellenar' ? 'text-gray-400' : 'text-gray-700'
                  }`}>
                    {m.tipo === 'liberacion' ? '+ ' : ''}{cantidadMovimiento(m, producto, esMarca, tipo)}
                  </span>
                </div>
                {abierta && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-line break-words">
                    {m.nota}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ReporteDiario() {
  const [fecha, setFecha]   = useState(hoyISO);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  // Detalle de una celda de Entradas o Salidas: { producto, tipo }.
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    let activo = true;
    api.get(`/productos/reporte-diario?fecha=${fecha}`)
      .then(d => { if (activo) { setData(d); setError(''); } })
      .catch(e => { if (activo) setError(e.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [fecha]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  const productos = data?.productos ?? [];
  // El polvo va en su propio grupo: es granel aunque se cuente por unidades.
  const granel = productos.filter(p => p.tipo_liquido === 'granel' && !esPolvo(p));
  const polvo  = productos.filter(esPolvo);
  const marca  = productos.filter(p => p.tipo_liquido === 'marca');
  // La columna Devuelto solo aparece si hubo algo devuelto ese día.
  const hayDevuelto = productos.some(p => Number(p.devuelto_medidas) > 0);

  // "Había al inicio" y "Queda al final": por unidad, una línea; granel,
  // rellenadas + a granel.
  const existenciaCelda = (p, botellas, granel) => {
    if (porUnidad(p)) return <span>{textoBotellas(botellas, p.medidas_por_botella, { marca: true })}</span>;
    return (
      <span className="block">
        <span className="block">Rellenadas: {textoBotellas(botellas, p.medidas_por_botella)}</span>
        <span className="block text-gray-500">A granel: {textoGranelFmt(granel, p.medidas_por_bidon, p.medidas_por_botella)}</span>
      </span>
    );
  };
  const inicioCelda = (p) => existenciaCelda(p, p.inicio_botellas_medidas, p.inicio_granel_medidas);
  const quedaCelda  = (p) => existenciaCelda(p, p.fin_botellas_medidas, p.fin_granel_medidas);

  const grupo = (titulo, lista) => {
    if (lista.length === 0) return null;
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">{titulo}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-sm text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Producto</th>
                <th className="px-4 py-3 text-left">Entradas</th>
                <th className="px-4 py-3 text-left">Salidas</th>
                {hayDevuelto && <th className="px-4 py-3 text-left">Devuelto</th>}
                <th className="px-4 py-3 text-left">Había al inicio</th>
                <th className="px-4 py-3 text-left">Queda al final</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map(p => {
                const esMarca = porUnidad(p);
                return (
                  <tr key={p.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{esMarca && p.marca ? p.marca : p.nombre}</p>
                      {esMarca && p.marca && <p className="text-sm text-gray-400">{p.nombre}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <CeldaMovimiento lineas={lineasEntradas(p, esMarca)} hayAlgo={p.rellenado_medidas > 0}
                        onClick={() => setDetalle({ producto: p, tipo: 'entradas' })} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {/* Por notas más las salidas manuales (merma, dañado…). */}
                      <CeldaMovimiento lineas={lineasSalidas(p, esMarca)} hayAlgo={p.rellenado_medidas > 0}
                        onClick={() => setDetalle({ producto: p, tipo: 'salidas' })} />
                    </td>
                    {hayDevuelto && (
                      <td className="px-4 py-3 text-gray-700">
                        {/* Ventas anuladas ese día: el producto volvió al estante. */}
                        <CeldaMovimiento lineas={lineasDevuelto(p, esMarca)}
                          onClick={() => setDetalle({ producto: p, tipo: 'devueltos' })} />
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-700">{inicioCelda(p)}</td>
                    <td className="px-4 py-3 text-gray-700">{quedaCelda(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Día y Exportar, en un mismo renglón y del mismo alto (como en Ventas). */}
      <div className="flex items-center gap-3">
        <label className="flex-1 min-w-0 h-11 flex items-center gap-2 px-4 rounded-lg border border-gray-300 bg-white text-base text-gray-800 hover:bg-gray-50 transition-colors cursor-pointer">
          <span className="text-gray-500 flex-shrink-0">Día:</span>
          <input
            type="date" value={fecha} max={hoyISO()}
            onChange={(e) => setFecha(e.target.value || hoyISO())}
            className="flex-1 min-w-0 bg-transparent font-medium text-base outline-none cursor-pointer"
          />
        </label>

        <div ref={exportRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setExportOpen(v => !v)}
            disabled={productos.length === 0}
            aria-haspopup="menu" aria-expanded={exportOpen}
            className="h-11 flex items-center gap-1.5 px-4 rounded-lg text-base font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar
          </button>
          {exportOpen && (
            <div role="menu" className="absolute right-0 mt-1 z-20 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => { setExportOpen(false); imprimirReporte(data); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659" />
                </svg>
                Exportar PDF
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); descargarReporteCSV(data); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Descargar CSV
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-500 -mt-1">{fechaLegible(fecha)}</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      ) : productos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No hay productos de marca o granel para mostrar.</p>
      ) : (
        <>
          {grupo('Granel', granel)}
          {grupo('Polvo', polvo)}
          {grupo('Marca', marca)}
        </>
      )}

      {detalle && (
        <MovimientosDiaModal
          producto={detalle.producto}
          tipo={detalle.tipo}
          fecha={fecha}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

export default function Inventario() {
  const { usuario } = useAuth();
  const esAdmin = esAdminFn(usuario?.rol);
  // Vista (solo admin): lista de Inventario o Reporte diario; se cambia con el botón de la cabecera.
  const [vista, setVista] = useState('inventario');

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
  // Recién creados en esta sesión: nacen en cero y no avisan hasta su primera entrada.
  const [recienCreados,   setRecienCreados]   = useState(() => new Set());
  // Interruptores de Ajustes → Alertas; sin dato (cargando o con error), todo encendido.
  const [ajustesAlertas,  setAjustesAlertas]  = useState(null);
  useEffect(() => {
    let activo = true;
    api.get('/ajustes')
      .then(data => { if (activo && data) setAjustesAlertas(data); })
      .catch(() => {});
    return () => { activo = false; };
  }, []);
  const conAlertaStock  = ajustesAlertas?.alerta_stock !== false;
  const conAlertaGranel = ajustesAlertas?.alerta_granel !== false;
  /** Semáforo de existencia; con su alerta apagada, o recién creado, no avisa. */
  const estadoStock = (p) => (!conAlertaStock || recienCreados.has(p.id) ? 'ok' : (p.estado_stock ?? 'ok'));
  /** Semáforo de los bidones; igual, con su propio interruptor. */
  const estadoGranel = (p) => (!conAlertaGranel || recienCreados.has(p.id) ? 'ok' : p.estado_granel);

  // Filtro de la lista: 'todos', una categoría o 'desactivados' (solo admin).
  const [filtro, setFiltro] = useState('todos');
  const verArchivados = filtro === 'desactivados';
  // Desactivados: se cargan al entrar (admin) para el número del filtro.
  const [archivados,      setArchivados]      = useState([]);
  const [archLoading,     setArchLoading]     = useState(true);
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

  // Catálogos de Ajustes → Inventario, solo los activos (el modal conserva el del
  // producto que ya lo usa).
  const [marcas, setMarcas] = useState([]);
  const [graneles, setGraneles] = useState([]);
  const [tamanosBolsa, setTamanosBolsa] = useState([]);
  // Tipos de granel, todos; el modal decide cuáles ofrece.
  const [tiposGranel, setTiposGranel] = useState([]);
  const nombreTipoGranel = new Map(tiposGranel.map(t => [t.id, t.nombre]));

  useEffect(() => {
    let activo = true;
    const activos = (data) => (data ?? []).filter(x => x.activo).map(x => x.nombre);
    api.get('/etiquetas/marcas-producto')
      .then(data => { if (activo) setMarcas(activos(data)); })
      .catch(() => {});
    api.get('/etiquetas/graneles-producto')
      .then(data => { if (activo) setGraneles(activos(data)); })
      .catch(() => {});
    api.get('/etiquetas/tamanos-bolsa')
      .then(data => { if (activo) setTamanosBolsa(activos(data)); })
      .catch(() => {});
    api.get('/etiquetas/tipos-granel')
      .then(data => { if (activo) setTiposGranel(data ?? []); })
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

  // Resaltado desde ?highlight=<id> (alerta del menú).
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

  const stockBajo = productos.filter(p => estadoStock(p) !== 'ok');
  // El aviso se oculta en la sesión; su firma incluye la existencia, así reaparece
  // si cambia.
  const stockSig = stockBajo.map(p => `${p.id}:${p.stock_actual}`).join(',');
  const mostrarStockBajo = stockBajo.length > 0 && stockSig !== stockOcultoSig;
  // Granel por acabarse o agotado (solo productos granel).
  const granelBajo = productos.filter(p => esGranelLiquido(p) && estadoGranel(p) && estadoGranel(p) !== 'ok');
  // Igual que el aviso de existencia.
  const granelSig = granelBajo.map(p => `${p.id}:${p.stock_granel_medidas}`).join(',');
  const mostrarGranel = granelBajo.length > 0 && granelSig !== granelOcultoSig;

  // Reemplaza un producto en la lista; con existencia deja de ser "recién creado".
  const reemplazarProducto = (prod) => {
    setProductos(prev => prev.map(p => (p.id === prod.id ? prod : p)));
    setInfoProducto(prev => (prev && prev.id === prod.id ? prod : prev));
    if (Number(prod.stock_actual) > 0 || Number(prod.stock_granel_medidas) > 0) {
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
      setProductos(prev => [...prev, resultado].sort(ordenProd));
      // Nace en cero: no avisa hasta su primera entrada.
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
  useEffect(() => {
    if (!esAdmin) return undefined;
    let activo = true;
    api.get('/productos?archivados=1')
      .then(data => { if (activo) setArchivados(data); })
      .catch(e => { if (activo) setArchError(e.message); })
      .finally(() => { if (activo) setArchLoading(false); });
    return () => { activo = false; };
  }, [esAdmin]);
  const visibles = filtro === 'todos' || verArchivados
    ? productos
    : productos.filter(p => categoriaProd(p) === filtro);
  const conteos = {
    todos: productos.length,
    granel: productos.filter(p => categoriaProd(p) === 'granel').length,
    marca: productos.filter(p => categoriaProd(p) === 'marca').length,
    bolsa: productos.filter(p => categoriaProd(p) === 'bolsa').length,
    desactivados: archivados.length,
  };
  const handleArchivar = async () => {
    const p = prodAArchivar;
    await api.patch(`/productos/${p.id}/archivar`, { archivado: true });
    setProductos(prev => prev.filter(x => x.id !== p.id));
    setSeleccionados(prev => { const n = new Set(prev); n.delete(p.id); return n; });
    setArchivados(prev => [...prev, p].sort(ordenProd));
    setProdAArchivar(null);
  };
  const restaurarProducto = async (p) => {
    const restaurado = await api.patch(`/productos/${p.id}/archivar`, { archivado: false });
    setArchivados(prev => prev.filter(x => x.id !== p.id));
    setProductos(prev => [...prev, restaurado].sort(ordenProd));
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
    visibles.length > 0 && visibles.every(p => seleccionados.has(p.id));
  const toggleTodos = () => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      const yaTodos = visibles.every(p => next.has(p.id));
      visibles.forEach(p => { if (yaTodos) next.delete(p.id); else next.add(p.id); });
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

  // Acciones de existencia (para todos).
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
      {esGranelLiquido(p) && (
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
        <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 pt-10 md:pt-14 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500">
            {/* Como en Ventas: dice qué se está viendo, sin la cantidad. */}
            {esAdmin && vista === 'reporte' ? 'Reporte diario'
              : filtro === 'todos' ? 'Todos los productos' : FILTRO_CFG[filtro].label}
          </p>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-3">
            {/* Cambia entre la lista y el Reporte diario (antes eran pestañas). */}
            <button
              onClick={() => setVista(v => (v === 'reporte' ? 'inventario' : 'reporte'))}
              aria-label={vista === 'reporte' ? 'Ver inventario' : 'Ver reporte diario'}
              title={vista === 'reporte' ? 'Ver inventario' : 'Ver reporte diario'}
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors flex-shrink-0 ${
                vista === 'reporte'
                  ? 'border-blue bg-light-blue text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {vista === 'reporte' ? (
                /* Lista */
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                /* Reporte */
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setModalProducto('nuevo')}
              aria-label="Agregar producto"
              className="w-11 h-11 rounded-full bg-blue hover:opacity-90 text-white flex items-center justify-center transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}
        </div>
      </div>

      <SucursalBar />

      {/* Contenido */}
      <div className="max-w-movil md:max-w-7xl mx-auto px-6 md:px-8 py-4 space-y-4">

      {esAdmin && vista === 'reporte' ? <ReporteDiario /> : (
      <>

      {/* Filtros por categoría (y Desactivados, solo admin) */}
      {!loading && !error && (productos.length > 0 || conteos.desactivados > 0) && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setFiltro('todos')}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === 'todos'
                ? 'bg-blue text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            Todos: {conteos.todos}
          </button>
          {Object.entries(FILTRO_CFG)
            .filter(([id]) => id !== 'desactivados' || esAdmin)
            .map(([id, cfg]) => {
              const activo = filtro === id;
              return (
                <button
                  key={id}
                  onClick={() => setFiltro(id)}
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activo ? cfg.clsActive : cfg.cls
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${activo ? 'bg-white' : cfg.dot}`} />
                  {cfg.label}: {conteos[id]}
                </button>
              );
            })}
        </div>
      )}

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
          <div className="flex items-start gap-2 pr-6">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="space-y-1">
              {stockBajo.map(p => (
                <p key={p.id} className="text-sm text-amber-800">
                  <span className="font-semibold">{tituloProd(p)}:</span> {mensajeAvisoBotellas(p)}
                  {esGranelLiquido(p) && Number(p.stock_granel_medidas) >= medidasPorBotella(p) && medidasPorBotella(p) > 0 && (
                    <button
                      onClick={() => setModalRellenar(p)}
                      className="ml-1.5 underline hover:no-underline font-semibold text-amber-900"
                    >
                      Rellenar
                    </button>
                  )}
                </p>
              ))}
            </div>
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
          <div className="flex items-start gap-2 pr-6">
            <svg className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="space-y-1">
              {granelBajo.map(p => (
                <p key={p.id} className="text-sm text-orange-800">
                  <span className="font-semibold">{tituloProd(p)}:</span> {mensajeAvisoGranel(p)}
                </p>
              ))}
            </div>
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

      {!loading && !error && !verArchivados && productos.length === 0 && (
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

      {!loading && !error && !verArchivados && productos.length > 0 && visibles.length === 0 && (
        <p className="text-sm text-gray-400 italic py-2">No hay productos de esta categoría.</p>
      )}

      {!loading && !error && !verArchivados && visibles.length > 0 && (
        /* Separado de los filtros, como en Gestión de máquinas. */
        <div className="pt-2">
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
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Producto</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Precios</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">Existencia</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 uppercase tracking-wide">A granel</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibles.map(p => {
                    const es = estadoStock(p);
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
                            <span className="font-medium text-gray-800">{tituloProd(p)}</span>
                            <ChipTipo p={p} />
                            {recienCreados.has(p.id) && <ChipNuevo />}
                          </div>
                          {subtituloProd(p) && <p className="text-sm text-gray-400 mt-0.5">{subtituloProd(p)}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">
                          {p.clase === 'bolsa' ? (
                            <div>Pieza: <span className="font-medium text-gray-700">{precioTxt(p.precio_unitario)}</span></div>
                          ) : (
                            <>
                              {esGranelLiquido(p) && (
                                <div>Medida: <span className="font-medium text-gray-700">{precioTxt(p.precio_unitario)}</span></div>
                              )}
                              <div>{porUnidad(p) ? 'Pieza' : 'Botella'}: <span className="font-medium text-gray-700">{precioTxt(p.precio_botella)}</span></div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className={`flex items-start gap-2 ${es !== 'ok' ? 'flex-wrap' : ''}`}>
                            {/* El punto naranja (algo apartado en notas) va a la izquierda; los avisos, a la derecha y, si no caben, abajo. */}
                            {es === 'ok' && medidasApartadas(p) > 0 && <PuntoApartado />}
                            <span className="min-w-0 font-medium text-gray-800"><Partes partes={partesDisponible(p)} /></span>
                            {es !== 'ok' && <BadgeEstado estado={es} />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {esGranelLiquido(p)
                            ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span><Partes partes={partesGranel(p)} /></span>
                                <BadgeGranel estado={estadoGranel(p)} />
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
                                title="Desactivar (ocultar del inventario)"
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
            {visibles.map(p => {
              const es = estadoStock(p);
              const rowCls = es === 'agotado' ? 'bg-red-50/40' : es === 'por_agotarse' ? 'bg-amber-50/40' : 'bg-white';
              return (
                <button
                  key={p.id}
                  data-producto-id={p.id}
                  type="button"
                  onClick={() => setInfoProducto(p)}
                  className={`w-full text-left rounded-xl shadow-sm border border-gray-100 px-4 py-5 hover:shadow-md active:opacity-80 transition ${rowCls}`}
                >
                  {/* Nombre a la izquierda; chips de tipo y "Nuevo" arriba a la derecha. */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {es !== 'ok' && <IconoAdvertencia severity={es} />}
                      <p className={`font-semibold text-sm ${colorTextoTipo(p)}`}>{tituloProd(p)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <ChipTipo p={p} />
                      {recienCreados.has(p.id) && <ChipNuevo />}
                    </div>
                  </div>
                  {/* Como en el detalle: cada existencia con su título; el granel líquido, bidones y botellas lado a lado. */}
                  <div className={`mt-3 ${esGranelLiquido(p) ? 'grid grid-cols-2 gap-3' : ''}`}>
                    {esGranelLiquido(p) && (
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Bidones</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-md font-semibold text-gray-700"><Partes partes={partesGranel(p)} /></span>
                          <BadgeGranel estado={estadoGranel(p)} />
                        </div>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{tituloExistencia(p)}</p>
                      <div className={`flex items-start gap-2 ${es !== 'ok' ? 'flex-wrap' : ''}`}>
                        {/* El punto naranja (algo apartado en notas) va a la izquierda; los avisos, a la derecha y, si no caben, abajo. */}
                        {es === 'ok' && medidasApartadas(p) > 0 && <PuntoApartado />}
                        <span className="min-w-0 text-md font-semibold text-gray-700"><Partes partes={partesDisponible(p)} /></span>
                        {es !== 'ok' && <BadgeEstado estado={es} />}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Desactivados (filtro, solo admin) */}
      {esAdmin && !loading && !error && verArchivados && (
        <div>
          {archLoading ? (
            <p className="text-sm text-gray-400 py-4">Cargando…</p>
          ) : archError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{archError}</div>
          ) : archivados.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-2">No hay productos desactivados.</p>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
              {archivados.map(p => (
                <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{tituloProd(p)}</p>
                    {subtituloProd(p) && <p className="text-sm text-gray-400">{subtituloProd(p)}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => restaurarProducto(p)}
                    className="flex-shrink-0 text-sm font-medium text-blue hover:text-blue-800 border border-blue/30 hover:bg-light-blue rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Reactivar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      </>
      )}

      </div>

      {/* Modal info producto (mobile) */}
      {infoProducto && (() => {
        const p = infoProducto;
        const es = estadoStock(p);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 md:hidden">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
                <h2 className="text-base font-semibold text-gray-900">Producto</h2>
                <div className="flex items-center gap-2">
                  {esAdmin && (
                    <MenuOpcionesProducto
                      onEditar={() => { setInfoProducto(null); setModalProducto(p); }}
                      onDesactivar={() => { setInfoProducto(null); setProdAArchivar(p); }}
                      onEliminar={() => { setInfoProducto(null); setProdAEliminar(p); }}
                    />
                  )}
                  <button onClick={() => setInfoProducto(null)} aria-label="Cerrar" className="p-1.5 text-gray-400 hover:text-gray-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-5 space-y-5 overflow-y-auto">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-gray-900">{tituloProd(p)}</p>
                    <ChipTipo p={p} />
                            {recienCreados.has(p.id) && <ChipNuevo />}
                  </div>
                  {/* En el granel líquido el subtítulo es su tipo (Jabón, Suavizante…). */}
                  {(() => {
                    const sub = (esGranelLiquido(p) && nombreTipoGranel.get(p.tipo_granel_id)) || subtituloProd(p);
                    return sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>;
                  })()}
                </div>
                {/* Precio: bolsa = por pieza; granel = medida + botella; marca y polvo = pieza. */}
                {p.clase === 'bolsa' ? (
                  <div>
                    <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">Precio por pieza</p>
                    <p className="text-base font-medium text-gray-700">{precioTxt(p.precio_unitario)}</p>
                  </div>
                ) : (
                  <div className={esGranelLiquido(p) ? 'grid grid-cols-2 gap-4' : ''}>
                    {esGranelLiquido(p) && (
                      <div>
                        <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">Precio por medida</p>
                        <p className="text-base font-medium text-gray-700">{precioTxt(p.precio_unitario)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">{porUnidad(p) ? 'Precio por pieza' : 'Precio por botella'}</p>
                      <p className="text-base font-medium text-gray-700">{precioTxt(p.precio_botella)}</p>
                    </div>
                  </div>
                )}
                {esGranelLiquido(p) && (
                  <div>
                    <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">Bidones</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-medium text-gray-700"><Partes partes={partesGranel(p)} /></span>
                      <BadgeGranel estado={estadoGranel(p)} />
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">{tituloExistencia(p)}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-medium text-gray-800"><Partes partes={partesDisponible(p)} /></span>
                    {es !== 'ok' && <BadgeEstado estado={es} />}
                  </div>
                </div>
                {medidasApartadas(p) > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">Apartadas en notas</p>
                    <div className="flex items-start gap-2">
                      <PuntoApartado />
                      <span className="min-w-0 text-base font-medium text-gray-700"><Partes partes={partesApartadas(p)} /></span>
                    </div>
                  </div>
                )}


                <div className="space-y-3.5 pt-1">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setModalMovimiento({ producto: p, tipo: 'entrada' }); }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 border border-green-300 text-green-700 hover:bg-green-50 font-medium rounded-lg text-sm transition-colors"
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
                  {esGranelLiquido(p) && (
                    <button
                      type="button"
                      onClick={() => { setModalRellenar(p); }}
                      className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue hover:opacity-90 text-white font-medium rounded-lg text-sm transition-colors"
                    >
                      Rellenar botellas
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setModalHistorial(p); }}
                    className="w-full flex items-center justify-center gap-2 py-3.5 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg text-sm transition-colors"
                  >
                    <IconoHistorial />
                    Ver historial
                  </button>
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
          graneles={graneles}
          tamanosBolsa={tamanosBolsa}
          tiposGranel={tiposGranel}
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

      {/* Modal: Eliminar varios (con advertencia de los que tienen historia) */}
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
                            ? 'Ninguno se puede eliminar porque tiene movimientos o se usó en notas (desactívalos para ocultarlos):'
                            : 'Estos tienen movimientos o se usaron en notas y no se eliminarán (desactívalos para ocultarlos):'}
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
