import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatFechaHora12 } from '../lib/fecha';

const BADGE_TIPO_SERVICIO = {
  AUTOSERVICIO: 'Autoservicio',
  EDREDON:      'Edredón',
  POR_ENCARGO:  'Por encargo',
};

const MAQUINA_TIPO_LABEL = {
  lavadora_mediana: 'Mediana',
  lavadora_jumbo:   'Jumbo',
  secadora:         'Secadora',
};

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

// Unidad de venta de un producto en texto ("2 botellas" / "3 tapas").
function unidadProdTxt(p) {
  const n = Number(p.cantidad);
  if (p.unidad === 'pieza') return n === 1 ? 'pieza' : 'piezas';
  if (p.unidad === 'botella') {
    if (p.tipo_liquido === 'marca') return n === 1 ? 'unidad' : 'unidades';
    return n === 1 ? 'botella' : 'botellas';
  }
  return n === 1 ? 'tapa' : 'tapas';
}
function nombreProd(p) {
  return p.clase === 'bolsa' && p.tamano_bolsa ? `Bolsa ${p.tamano_bolsa}` : p.nombre;
}

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtFechaHora(iso) {
  if (!iso) return '—';
  return formatFechaHora12(iso);
}

// Máquinas efectivamente usadas por una carga (persisten aunque el ciclo ya
// haya terminado). Se ignoran las eliminadas (removidas), que no deben cobrarse.
function maquinasDeCarga(cg) {
  return [
    cg.lavadora_usada_id && !cg.lavadora_removida && {
      nombre: cg.lavadora_usada_nombre,
      tipo: MAQUINA_TIPO_LABEL[cg.lavadora_usada_tipo] ?? 'Lavadora',
      precio: Number(cg.precio_lavadora),
    },
    cg.secadora_usada_id && !cg.secadora_removida && {
      nombre: cg.secadora_usada_nombre,
      // La secadora es de un solo tamaño: sin tamaño, solo "Secadora".
      tipo: MAQUINA_TIPO_LABEL[cg.secadora_usada_tipo] ?? 'Secadora',
      precio: Number(cg.precio_secadora),
    },
  ].filter(Boolean);
}

// Fila del ticket: etiqueta a la izquierda, valor a la derecha. Estilo recibo.
function Linea({ label, value, fuerte }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm text-right ${fuerte ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
        {value}
      </span>
    </div>
  );
}

// Construye el texto plano del ticket que se envía por WhatsApp. Refleja el
// mismo desglose que se ve en pantalla (cargas, máquinas, productos).
function armarTextoTicket(nota) {
  const L = ['*Lavandería El Sol*', `Nota: ${nota.folio ?? `#${nota.id}`}`];

  if (nota.cliente_nombre) {
    const apellido = nota.cliente_apellido ? ` ${nota.cliente_apellido}` : '';
    L.push(`Cliente: ${nota.cliente_nombre}${apellido}`);
  }
  L.push(`Tipo: ${BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? nota.tipo_servicio}`);

  // Vuelca las líneas de una carga (máquinas, productos, ajuste) al arreglo L.
  const volcarCarga = cg => {
    L.push(`Carga ${cg.orden}:`);
    maquinasDeCarga(cg).forEach(m => {
      L.push(`  • ${m.nombre} (${m.tipo}) — ${fmtMonto(m.precio)}`);
    });
    // Las tapas son información interna: no se listan en el ticket.
    (cg.productos ?? []).filter(p => p.unidad !== 'tapa').forEach(p => {
      const monto = p.es_por_tapa && Number(p.subtotal) === 0 ? 'Incluido' : fmtMonto(p.subtotal);
      L.push(`  • ${nombreProd(p)} x${p.cantidad} ${unidadProdTxt(p)} — ${monto}`);
    });
    if (Number(cg.ajuste)) {
      L.push(`  • Ajuste: ${Number(cg.ajuste) > 0 ? '+' : ''}${fmtMonto(cg.ajuste)}`);
    }
  };

  const cargas      = nota.cargas ?? [];
  const originales  = cargas.filter(cg => !cg.es_adicional);
  const adicionales = cargas.filter(cg => cg.es_adicional);

  if (originales.length > 0) {
    L.push('', '*Desglose*');
    originales.forEach(volcarCarga);
  }
  if (adicionales.length > 0) {
    L.push('', '*Adicional*');
    adicionales.forEach(volcarCarga);
  }

  const productos = (nota.productos ?? []).filter(p => p.unidad !== 'tapa');
  if (productos.length > 0) {
    L.push('', '*Productos*');
    productos.forEach(p => {
      const monto = p.es_por_tapa && Number(p.subtotal) === 0 ? 'Incluido' : fmtMonto(p.subtotal);
      L.push(`  • ${nombreProd(p)} x${p.cantidad} ${unidadProdTxt(p)} — ${monto}`);
    });
  }

  if (Number(nota.ajuste)) {
    L.push('', `Ajuste: ${Number(nota.ajuste) > 0 ? '+' : ''}${fmtMonto(nota.ajuste)}`);
  }

  L.push('', `*Total: ${fmtMonto(nota.precio_total)}*`);
  if (nota.fecha_entrega) {
    L.push(`Entrega: ${fmtFecha(nota.fecha_entrega)}`);
  }
  L.push('', '¡Gracias por su preferencia!');
  return L.join('\n');
}

export default function TicketNota() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [nota, setNota]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  // Autoservicio es anónimo (sin cliente): el empleado captura aquí el teléfono
  // para enviar el ticket por WhatsApp.
  const [telefonoManual, setTelefonoManual] = useState('');

  useEffect(() => {
    let activo = true;
    api.get(`/notas/${id}`)
      .then(data => {
        if (!activo) return;
        setNota(data);
        // Precargar el teléfono ya guardado en la nota (si lo hay).
        if (data?.telefono) setTelefonoManual(String(data.telefono));
      })
      .catch(err => { if (activo) setError(err.message); })
      .finally(() => { if (activo) setLoading(false); });
    return () => { activo = false; };
  }, [id]);

  // Guarda el teléfono capturado en la nota (best-effort; no bloquea el envío).
  async function guardarTelefonoEnNota() {
    const digits = String(telefonoManual || '').replace(/\D/g, '');
    if (nota?.cliente_telefono || digits === String(nota?.telefono ?? '')) return;
    try {
      await api.patch(`/notas/${id}/telefono`, { telefono: digits });
      setNota(prev => (prev ? { ...prev, telefono: digits || null } : prev));
    } catch { /* no bloquear por esto */ }
  }

  // Teléfono a usar: el del cliente (Por Encargo) o el capturado a mano
  // (Autoservicio anónimo).
  const telefonoDestino = nota?.cliente_telefono || telefonoManual;
  const telefonoDigits  = String(telefonoDestino || '').replace(/\D/g, '');
  const puedeEnviar     = telefonoDigits.length >= 10;

  function enviarPorWhatsapp() {
    if (!puedeEnviar) return;
    guardarTelefonoEnNota(); // best-effort, no bloquea el envío
    const phone = telefonoDigits.startsWith('52') ? telefonoDigits : `52${telefonoDigits}`;
    const texto = encodeURIComponent(armarTextoTicket(nota));
    window.open(`https://wa.me/${phone}?text=${texto}`, '_blank', 'noopener,noreferrer');
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue" />
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

  if (!nota) return null;

  const cargas      = nota.cargas ?? [];
  const productos   = nota.productos ?? [];
  // Cargas creadas al dar de alta la nota (originales) vs. las agregadas
  // después (adicionales), para mostrarlas en bloques separados.
  const originales  = cargas.filter(cg => !cg.es_adicional);
  const adicionales = cargas.filter(cg => cg.es_adicional);

  // Render de una carga del recibo: encabezado con su total y el detalle de
  // máquinas, productos y ajuste. Se reusa para el bloque original y el adicional.
  const renderCarga = cg => {
    const maquinas   = maquinasDeCarga(cg);
    const prods      = cg.productos ?? [];
    const totalProds = prods.reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
    const totalCarga = Number(cg.precio_lavadora) + Number(cg.precio_secadora)
      + Number(cg.ajuste ?? 0) + totalProds;
    return (
      <div key={cg.id}>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Carga {cg.orden}</span>
          <span className="text-sm font-semibold text-gray-700">{fmtMonto(totalCarga)}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {maquinas.map((m, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-700">{m.nombre} <span className="text-xs text-gray-400">· {m.tipo}</span></span>
              <span className="text-sm text-gray-600">{fmtMonto(m.precio)}</span>
            </div>
          ))}
          {/* Las tapas son información interna: no se muestran en el ticket. */}
          {prods.filter(p => p.unidad !== 'tapa').map(p => (
            <div key={p.id} className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-700">{nombreProd(p)} <span className="text-xs text-gray-400">×{p.cantidad} {unidadProdTxt(p)}</span></span>
              {p.es_por_tapa && Number(p.subtotal) === 0
                ? <span className="text-sm text-green-700">Incluido</span>
                : <span className="text-sm text-gray-600">{fmtMonto(p.subtotal)}</span>}
            </div>
          ))}
          {Number(cg.ajuste) !== 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-700">Ajuste</span>
              <span className="text-sm text-gray-600">{Number(cg.ajuste) > 0 ? '+' : ''}{fmtMonto(cg.ajuste)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-full bg-slate-100">

      {/* Cabecera */}
      <div className="bg-white border-b-2 border-gray-200">
        <div className="max-w-2xl mx-auto px-6 pt-10 md:pt-6 pb-4 flex items-center gap-2">
          <button
            onClick={() => navigate(`/notas/${id}`)}
            aria-label="Volver"
            className="flex-shrink-0 w-11 h-11 rounded-full border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center justify-center transition duration-200 ease-out active:scale-[1.3] active:bg-white active:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900 leading-tight">Ticket</h1>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">

        {/* Recibo */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">

          {/* Encabezado del recibo */}
          <div className="px-5 py-5 text-center border-b border-dashed border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Lavandería El Sol</h2>
            <p className="text-sm text-gray-500 mt-0.5">Nota {nota.folio ?? `#${nota.id}`}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtFechaHora(nota.created_at)}</p>
          </div>

          {/* Datos generales */}
          <div className="px-5 py-3 border-b border-dashed border-gray-200">
            <Linea
              label="Cliente"
              value={nota.cliente_nombre
                ? `${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`
                : 'Anónimo'}
            />
            {nota.cliente_telefono && <Linea label="Teléfono" value={nota.cliente_telefono} />}
            <Linea label="Tipo" value={BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? nota.tipo_servicio} />
          </div>

          {/* Desglose por cargas (originales) */}
          {originales.length > 0 && (
            <div className="px-5 py-3 border-b border-dashed border-gray-200 space-y-3">
              {originales.map(renderCarga)}
            </div>
          )}

          {/* Cargas adicionales (agregadas después de crear la nota) */}
          {adicionales.length > 0 && (
            <div className="px-5 py-3 border-b border-dashed border-gray-200 space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Adicional</p>
              {adicionales.map(renderCarga)}
            </div>
          )}

          {/* Productos de la nota (nivel nota, sin carga). Las tapas son
              información interna y no se muestran. */}
          {productos.filter(p => p.unidad !== 'tapa').length > 0 && (
            <div className="px-5 py-3 border-b border-dashed border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Productos</p>
              <div className="space-y-0.5">
                {productos.filter(p => p.unidad !== 'tapa').map(p => (
                  <div key={p.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-gray-700">{nombreProd(p)} <span className="text-xs text-gray-400">×{p.cantidad} {unidadProdTxt(p)}</span></span>
                    {p.es_por_tapa && Number(p.subtotal) === 0
                      ? <span className="text-sm text-green-700">Incluido</span>
                      : <span className="text-sm text-gray-600">{fmtMonto(p.subtotal)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totales y estado */}
          <div className="px-5 py-3 border-b border-dashed border-gray-200">
            {Number(nota.ajuste) !== 0 && nota.ajuste != null && (
              <Linea label="Ajuste" value={`${Number(nota.ajuste) > 0 ? '+' : ''}${fmtMonto(nota.ajuste)}`} />
            )}
            <Linea label="Total" value={fmtMonto(nota.precio_total)} fuerte />
            {nota.fecha_entrega && <Linea label="Entrega" value={fmtFecha(nota.fecha_entrega)} />}
          </div>

          {/* Pie */}
          <p className="px-5 py-4 text-center text-xs text-gray-400">¡Gracias por su preferencia!</p>
        </div>

        {/* Teléfono para WhatsApp: si la nota no tiene cliente (Autoservicio
            anónimo), se captura a mano aquí. */}
        {!nota.cliente_telefono && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Teléfono para enviar el ticket</label>
            <input
              type="tel"
              inputMode="numeric"
              value={telefonoManual}
              onChange={(e) => setTelefonoManual(e.target.value)}
              onBlur={guardarTelefonoEnNota}
              placeholder="33-1234-5678"
              maxLength={12}
              className="w-full px-4 py-3.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue focus:border-transparent transition"
            />
          </div>
        )}

        {/* Enviar por WhatsApp */}
        <button
          onClick={enviarPorWhatsapp}
          disabled={!puedeEnviar}
          title={puedeEnviar ? 'Abrir WhatsApp con el ticket' : 'Escribe un teléfono válido (10 dígitos)'}
          className="w-full flex items-center justify-center gap-2 bg-[#27A910] hover:bg-[#218f0d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 19 19">
            <path d="M16.2312 2.76454C15.3557 1.88495 14.313 1.18752 13.164 0.712894C12.0149 0.238271 10.7823 -0.00405 9.53819 5.12002e-05C4.32513 5.12002e-05 0.0763821 4.22754 0.0763821 9.41453C0.0763821 11.077 0.515578 12.692 1.33668 14.117L0 19L5.01256 17.689C6.39698 18.4395 7.95327 18.8385 9.53819 18.8385C14.7513 18.8385 19 14.611 19 9.42403C19 6.90653 18.0166 4.54104 16.2312 2.76454ZM9.53819 17.2425C8.12512 17.2425 6.7407 16.8625 5.52814 16.15L5.24171 15.979L2.26281 16.758L3.05528 13.87L2.86432 13.5755C2.07907 12.3282 1.66219 10.8863 1.66131 9.41453C1.66131 5.10154 5.19397 1.58655 9.52864 1.58655C11.6291 1.58655 13.6055 2.40354 15.0854 3.88554C15.8183 4.61121 16.3991 5.47445 16.7941 6.4252C17.1891 7.37594 17.3904 8.39526 17.3864 9.42403C17.4055 13.737 13.8729 17.2425 9.53819 17.2425ZM13.8538 11.3905C13.6151 11.2765 12.4503 10.7065 12.2402 10.621C12.0206 10.545 11.8678 10.507 11.7055 10.735C11.5432 10.9725 11.0945 11.5045 10.9608 11.6565C10.8271 11.818 10.6839 11.837 10.4452 11.7135C10.2065 11.5995 9.44271 11.343 8.54523 10.545C7.83869 9.91803 7.37085 9.14853 7.22764 8.91103C7.09397 8.67353 7.20854 8.55003 7.33266 8.42653C7.43769 8.32203 7.57136 8.15103 7.68593 8.01803C7.8005 7.88503 7.84824 7.78053 7.92462 7.62853C8.001 7.46703 7.96281 7.33403 7.90553 7.22003C7.84824 7.10603 7.37085 5.94704 7.1799 5.47204C6.98894 5.01604 6.78844 5.07304 6.64523 5.06354H6.18693C6.02462 5.06354 5.77638 5.12054 5.55678 5.35804C5.34673 5.59554 4.73568 6.16554 4.73568 7.32453C4.73568 8.48353 5.58543 9.60453 5.7 9.75653C5.81457 9.91803 7.37085 12.293 9.73869 13.3095C10.302 13.5565 10.7412 13.699 11.0849 13.8035C11.6482 13.984 12.1638 13.9555 12.5744 13.8985C13.0327 13.832 13.9779 13.3285 14.1688 12.7775C14.3693 12.2265 14.3693 11.761 14.3025 11.6565C14.2357 11.552 14.0925 11.5045 13.8538 11.3905Z" />
          </svg>
          Enviar por WhatsApp
        </button>
      </div>
    </div>
  );
}
