import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toBlob } from 'html-to-image';
import { etiquetaProducto, ordenProducto } from '../lib/formatoInventario';
import { api } from '../lib/api';
import { maquinasDeCarga, cargaVisibleEnTicket } from '../lib/ticketCargas';
import { notaAlPieDeTicket } from '../lib/ticketNotaPie';
import { formaPagoLabel } from '../lib/formasPago';

const BADGE_TIPO_SERVICIO = {
  AUTOSERVICIO: 'Autoservicio',
  EDREDON:      'Edredón',
  POR_ENCARGO:  'Por encargo',
};


// Tamaño de la carga tal como se nombra al cliente.
const TAMANO_CARGA_LABEL = { chico: 'Chica', grande: 'Grande', jumbo: 'Jumbo' };

function fmtMonto(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : '—';
}

// Lo único que el cliente ve de una carga Por Encargo: su tamaño ("Chica").
// En edredones no hay tamaño de carga, se usa el del edredón.
function tamanoCargaTxt(cg) {
  if (String(cg.tipo_prenda ?? '').toUpperCase() === 'EDREDON') {
    return cg.tamano_edredon ? `Edredón · ${cg.tamano_edredon}` : 'Edredón';
  }
  return TAMANO_CARGA_LABEL[cg.tamano] ?? null;
}

// Costo real de la carga: máquinas + productos + ajuste.
function costoDeCarga(cg) {
  const prods = (cg.productos ?? []).reduce((s, p) => s + Number(p.subtotal ?? 0), 0);
  return Number(cg.precio_lavadora) + Number(cg.precio_secadora)
    + Number(cg.ajuste ?? 0) + prods;
}

// Lo que el cliente paga por la carga. En Por Encargo con tope el precio ES el
// tope del tamaño (lo de adentro va incluido); el ajuste manual va aparte. Sin
// tope, y en los demás tipos de servicio, se cobra el costo real.
function precioDeCarga(cg, esEncargo) {
  if (esEncargo && cg.tope_carga != null) {
    return Number(cg.tope_carga) + Number(cg.ajuste ?? 0);
  }
  return costoDeCarga(cg);
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
  return etiquetaProducto(p) + (p.tipo_liquido === 'granel' ? ' · Granel' : '');
}

// En el ticket las fechas van como en un recibo impreso: 04/09/2026, y la hora
// de 24 h (14:08). En el resto de la app se siguen viendo como siempre
// ("04 sep 2026, 02:08 pm"); aquí manda el formato del papel.
function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtFechaHora(iso) {
  if (!iso) return '—';
  // hourCycle 'h23' y no `hour12: false`: este último puede imprimir la
  // medianoche como 24:00 en vez de 00:00.
  const hora = new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return `${fmtFecha(iso)} ${hora}`;
}

// Fila del ticket: etiqueta a la izquierda, valor a la derecha. Estilo recibo.
// El recibo imita un ticket de caja impreso: monoespaciada, mayúsculas,
// separadores de guiones y columnas alineadas. La fuente es la del sistema
// (`font-mono`) a propósito: el PNG que se manda por WhatsApp se rasteriza con
// `skipFonts: true`, así que una fuente web saldría cambiada en la imagen.

// Renglón de dos columnas: rótulo a la izquierda, dato pegado a la derecha.
function Linea({ label, value, fuerte }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="uppercase">{label}</span>
      <span className={`text-right whitespace-nowrap ${fuerte ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}

// Corte de guiones entre bloques, como el del papel.
function Corte() {
  return <div className="my-2 border-t border-dashed border-black/70" />;
}

// La hilera de asteriscos que cierra el total en los tickets de tienda. Se
// recorta al ancho del papel en vez de saltar de renglón.
function Asteriscos() {
  return (
    <p className="my-2 overflow-hidden whitespace-nowrap text-center leading-none" aria-hidden="true">
      {'*'.repeat(80)}
    </p>
  );
}

// Construye el texto plano del ticket que se envía por WhatsApp. Refleja el
// mismo desglose que se ve en pantalla (cargas, máquinas, productos).
function armarTextoTicket(nota, rfc, notaPie) {
  const L = ['*Lavandería El Sol*'];
  // Misma cabecera que el recibo impreso: dirección de la sucursal y luego el
  // R.F.C. (que sale tal cual se capturó en Ajustes, es texto libre).
  if (nota.sucursal_direccion) L.push(nota.sucursal_direccion);
  if (rfc) L.push(rfc);
  L.push(`Nota: ${nota.folio ?? `#${nota.id}`}`);

  if (nota.cliente_nombre) {
    const apellido = nota.cliente_apellido ? ` ${nota.cliente_apellido}` : '';
    L.push(`Cliente: ${nota.cliente_nombre}${apellido}`);
  }
  // Por Encargo se cobra la carga completa: el cliente solo ve tamaño y costo.
  // El tipo no se repite arriba: cada línea del desglose ya lo nombra.
  const esEncargo = nota.tipo_servicio === 'POR_ENCARGO';
  if (!esEncargo) {
    L.push(`Tipo: ${BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? nota.tipo_servicio}`);
  }
  L.push(`Método de pago: ${formaPagoLabel(nota.forma_pago) || 'Pendiente'}`);

  // Vuelca las líneas de una carga (máquinas, productos, ajuste) al arreglo L.
  const volcarCarga = cg => {
    L.push(`Carga ${cg.orden}:`);
    maquinasDeCarga(cg).forEach(m => {
      L.push(`  • 1 x ${m.nombre}${m.tipo ? ` (${m.tipo})` : ''} — ${fmtMonto(m.precio)}`);
    });
    // Las tapas son información interna: no se listan en el ticket.
    (cg.productos ?? []).filter(p => p.unidad !== 'tapa')
      .sort((a, b) => ordenProducto(a) - ordenProducto(b)).forEach(p => {
      const monto = p.es_por_tapa && Number(p.subtotal) === 0 ? 'Incluido' : fmtMonto(p.subtotal);
      L.push(`  • ${nombreProd(p)} x${p.cantidad} ${unidadProdTxt(p)} — ${monto}`);
    });
    if (Number(cg.ajuste)) {
      L.push(`  • Ajuste: ${Number(cg.ajuste) > 0 ? '+' : ''}${fmtMonto(cg.ajuste)}`);
    }
  };

  // Mismo criterio que la vista: las cargas que se quedaron sin nada que cobrar
  // no se listan.
  const cargas      = (nota.cargas ?? []).filter(cargaVisibleEnTicket);
  const originales  = cargas.filter(cg => !cg.es_adicional);
  const adicionales = cargas.filter(cg => cg.es_adicional);

  // En Por Encargo el bloque es la lista de servicios cobrados (una línea por
  // carga); en los demás tipos, el desglose carga por carga.
  const volcarBloque = lista => {
    if (esEncargo) {
      lista.forEach(cg => {
        const tam = tamanoCargaTxt(cg);
        L.push(`1 x Servicio por encargo${tam ? ` · ${tam}` : ''}`
             + ` — ${fmtMonto(precioDeCarga(cg, true))}`);
      });
      return;
    }
    lista.forEach(volcarCarga);
  };

  if (originales.length > 0) {
    L.push('', '*Desglose*');
    volcarBloque(originales);
  }
  if (adicionales.length > 0) {
    L.push('', '*Adicional*');
    volcarBloque(adicionales);
  }

  const productos = (nota.productos ?? []).filter(p => p.unidad !== 'tapa')
    .sort((a, b) => ordenProducto(a) - ordenProducto(b));
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
  if (notaPie) L.push('', notaPie);
  return L.join('\n');
}

export default function TicketNota() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [nota, setNota]       = useState(null);
  // Datos del negocio que se imprimen en el ticket (Ajustes): el R.F.C. en el
  // encabezado y la nota en letra chica al pie. Vacíos, no se muestran.
  const [rfcNegocio, setRfcNegocio] = useState('');
  // Hay una nota por tipo de servicio: lo que le sirve al cliente que lava él
  // mismo no es lo que le sirve al que deja su ropa a cargo del negocio.
  const [notasPie, setNotasPie] = useState({ autoservicio: '', encargo: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  // Autoservicio es anónimo (sin cliente): el empleado captura aquí el teléfono
  // para enviar el ticket por WhatsApp.
  const [telefonoManual, setTelefonoManual] = useState('');
  // El recibo que se convierte en imagen para mandar por WhatsApp.
  const reciboRef = useRef(null);
  const [enviando, setEnviando] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState('');

  const notaPie = notaAlPieDeTicket(nota?.tipo_servicio, notasPie);

  useEffect(() => {
    let activo = true;
    // Los ajustes son secundarios: si fallan, el ticket se muestra igual.
    api.get('/ajustes')
      .then(cfg => {
        if (!activo) return;
        setRfcNegocio(cfg?.rfc ?? '');
        setNotasPie({
          autoservicio: cfg?.ticket_nota_autoservicio ?? '',
          encargo:      cfg?.ticket_nota_encargo ?? '',
        });
      })
      .catch(() => {});
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

  // Convierte el recibo de la pantalla en un PNG (x2 para que se lea bien al
  // ampliarlo en el celular).
  async function ticketComoPng() {
    const nodo = reciboRef.current;
    if (!nodo) return null;
    // skipFonts: la hoja de Google Fonts es de otro origen y no se puede leer
    // para embeberla (SecurityError). El texto sale con la fuente ya cargada.
    const blob = await toBlob(nodo, {
      pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true, skipFonts: true,
    });
    if (!blob) return null;
    return new File([blob], `ticket-${nota.folio ?? nota.id}.png`, { type: 'image/png' });
  }

  // Manda el ticket como imagen. En celular se abre la hoja de compartir con el
  // PNG ya adjunto y el empleado elige el chat del cliente en WhatsApp (mandar
  // una imagen a un número por wa.me no es posible: ese enlace solo lleva
  // texto). En escritorio, donde no hay hoja de compartir, se descarga el PNG
  // para adjuntarlo a mano y se abre el chat del cliente con el ticket en texto.
  async function enviarPorWhatsapp() {
    if (!puedeEnviar || enviando) return;
    setEnviando(true);
    setAvisoEnvio('');
    guardarTelefonoEnNota(); // best-effort, no bloquea el envío
    try {
      const archivo = await ticketComoPng();
      if (archivo && navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: `Ticket ${nota.folio ?? `#${nota.id}`}` });
        return;
      }
      if (archivo) {
        const url = URL.createObjectURL(archivo);
        const a = document.createElement('a');
        a.href = url;
        a.download = archivo.name;
        a.click();
        URL.revokeObjectURL(url);
        setAvisoEnvio('Se descargó el ticket en imagen: adjúntalo en el chat que se abrió.');
      }
      const phone = telefonoDigits.startsWith('52') ? telefonoDigits : `52${telefonoDigits}`;
      const texto = encodeURIComponent(armarTextoTicket(nota, rfcNegocio, notaPie));
      window.open(`https://wa.me/${phone}?text=${texto}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      // Cancelar la hoja de compartir no es un error que reportar.
      if (err?.name !== 'AbortError') setAvisoEnvio('No se pudo generar la imagen del ticket.');
    } finally {
      setEnviando(false);
    }
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
  const productos   = [...(nota.productos ?? [])].sort((a, b) => ordenProducto(a) - ordenProducto(b));
  // Los productos de la nota que sí se imprimen: las tapas son información
  // interna y no salen en el ticket.
  const prodsNota   = productos.filter(p => p.unidad !== 'tapa');
  // Cargas creadas al dar de alta la nota (originales) vs. las agregadas
  // después (adicionales), para mostrarlas en bloques separados.
  const visibles    = cargas.filter(cargaVisibleEnTicket);
  const originales  = visibles.filter(cg => !cg.es_adicional);
  const adicionales = visibles.filter(cg => cg.es_adicional);
  const esEncargo   = nota.tipo_servicio === 'POR_ENCARGO';

  // Bloque de cargas. Por Encargo se cobra la carga completa (máquinas y
  // productos van dentro del precio): al cliente solo se le
  // muestra el servicio con su tamaño y su costo, una línea por carga.
  const renderBloqueCargas = lista => (
    esEncargo
      ? lista.map(cg => {
          const tam = tamanoCargaTxt(cg);
          return (
            <div key={cg.id} className="flex items-baseline justify-between gap-2">
              <span className="flex-1">
                <span className="inline-block w-9">1</span>
                SERVICIO POR ENCARGO{tam && ` ${tam.toUpperCase()}`}
              </span>
              <span className="whitespace-nowrap">{fmtMonto(precioDeCarga(cg, true))}</span>
            </div>
          );
        })
      : lista.map(renderCarga)
  );

  // Render de una carga del recibo: encabezado con su total y el detalle de
  // máquinas, productos y ajuste. Se reusa para el bloque original y el adicional.
  const renderCarga = cg => {
    const maquinas   = maquinasDeCarga(cg);
    const prods      = [...(cg.productos ?? [])].sort((a, b) => ordenProducto(a) - ordenProducto(b));
    const totalCarga = costoDeCarga(cg);

    return (
      <div key={cg.id} className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 font-bold">
          <span className="uppercase whitespace-nowrap">Carga {cg.orden}</span>
          <span className="whitespace-nowrap">{fmtMonto(totalCarga)}</span>
        </div>
        {maquinas.map((m, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2">
            {/* Cada carga usa a lo más una lavadora y una secadora: de ahí el 1. */}
            <span className="flex-1">
              <span className="inline-block w-9">1</span>
              {m.nombre.toUpperCase()}{m.tipo && ` ${m.tipo.toUpperCase()}`}
            </span>
            <span className="whitespace-nowrap">{fmtMonto(m.precio)}</span>
          </div>
        ))}
        {/* Las tapas son información interna: no se muestran en el ticket. */}
        {prods.filter(p => p.unidad !== 'tapa').map(p => (
          <div key={p.id} className="flex items-baseline justify-between gap-2">
            <span className="flex-1">
              <span className="inline-block w-9">{p.cantidad}</span>
              {nombreProd(p).toUpperCase()}
            </span>
            {p.es_por_tapa && Number(p.subtotal) === 0
              ? <span className="whitespace-nowrap">INCLUIDO</span>
              : <span className="whitespace-nowrap">{fmtMonto(p.subtotal)}</span>}
          </div>
        ))}
        {Number(cg.ajuste) !== 0 && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex-1"><span className="inline-block w-9" />AJUSTE</span>
            <span className="whitespace-nowrap">{Number(cg.ajuste) > 0 ? '+' : ''}{fmtMonto(cg.ajuste)}</span>
          </div>
        )}
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

        {/* Recibo (es lo que se manda por WhatsApp como imagen) */}
        {/* El recibo: imita un ticket de caja impreso (ver los auxiliares de
            arriba). Angosto como el papel térmico, y es este mismo nodo el que
            se rasteriza para mandarlo por WhatsApp. */}
        {/* El centrado va FUERA del nodo que se rasteriza: un `mx-auto` en el
            propio recibo desplaza el contenido dentro del lienzo del PNG y el
            ticket sale cortado por la derecha (sin los importes). */}
        <div className="mx-auto w-full max-w-[20rem]">
        <div
          ref={reciboRef}
          className="w-full bg-white px-4 py-6 font-mono text-[11px] leading-relaxed text-black shadow-sm"
        >
          {/* Encabezado del negocio */}
          <div className="text-center mb-5">
            <p className="text-sm font-bold tracking-[0.15em]">LAVANDERÍA EL SOL</p>
            {/* Dirección de la sucursal DONDE SE HIZO la nota (no la del
                negocio): con varias sucursales, el ticket tiene que decir a
                cuál volver. Se omite si esa sucursal no la tiene capturada. */}
            {nota.sucursal_direccion && (
              <p className="mt-1">{nota.sucursal_direccion.toUpperCase()}</p>
            )}
            {/* El R.F.C. sale tal cual se capturó en Ajustes (es texto libre). */}
            {rfcNegocio && <p className="mt-1">R.F.C. {rfcNegocio}</p>}
            <p className="mt-1">{fmtFechaHora(nota.created_at).toUpperCase()}</p>
          </div>

          <Corte />

          {/* Datos generales. El número de nota encabeza el bloque: es el dato
              con el que el cliente reclama su ropa. Sin cliente no se imprime
              la línea: al que viene de paso no le aporta nada leer "Anónimo". */}
          <div className="space-y-1 py-1">
            <Linea label="Nota" value={nota.folio ?? `#${nota.id}`} fuerte />
            {nota.fecha_entrega && <Linea label="Entrega" value={fmtFecha(nota.fecha_entrega).toUpperCase()} />}
            {nota.cliente_nombre && (
              <Linea
                label="Cliente"
                value={`${nota.cliente_nombre}${nota.cliente_apellido ? ' ' + nota.cliente_apellido : ''}`.toUpperCase()}
              />
            )}
            {nota.cliente_telefono && <Linea label="Teléfono" value={nota.cliente_telefono} />}
            {!esEncargo && (
              <Linea
                label="Tipo"
                value={(BADGE_TIPO_SERVICIO[nota.tipo_servicio] ?? nota.tipo_servicio).toUpperCase()}
              />
            )}
            {/* Cierra el bloque: en Autoservicio va debajo de TIPO y en Por
                Encargo debajo de TELÉFONO. La nota que todavía no se cobra
                (pasa en Por Encargo) sale como PENDIENTE. */}
            <Linea
              label="Método de pago"
              value={(formaPagoLabel(nota.forma_pago) || 'Pendiente').toUpperCase()}
            />
          </div>

          <Corte />

          <div className="my-5 space-y-2">
            {/* Encabezado de columnas, como en el papel */}
            <div className="my-1 flex items-baseline justify-between gap-2 font-bold">
              <span className="flex-1"><span className="inline-block w-9">CANT</span>DESCRIPCION</span>
              <span>IMPORTE</span>
            </div>

            {/* Desglose por cargas (originales) */}
            {originales.length > 0 && (
              <div className="mt-2 pb-4 space-y-3">{renderBloqueCargas(originales)}</div>
            )}

            {/* Cargas adicionales (agregadas después de crear la nota) */}
            {adicionales.length > 0 && (
              <>
                <Corte />
                <p className="font-bold">ADICIONAL</p>
                <div className=" space-y-3">{renderBloqueCargas(adicionales)}</div>
              </>
            )}

            {/* Productos de la nota (nivel nota, sin carga), con su propio título
                y su subtotal, igual que los bloques de carga. */}
            {prodsNota.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 font-bold">
                  <span className="uppercase whitespace-nowrap">Productos</span>
                  <span className="whitespace-nowrap">
                    {fmtMonto(prodsNota.reduce((s, p) => s + Number(p.subtotal ?? 0), 0))}
                  </span>
                </div>
                {prodsNota.map(p => (
                  <div key={p.id} className="flex items-baseline justify-between gap-2">
                    <span className="flex-1">
                      <span className="inline-block w-9">{p.cantidad}</span>
                      {nombreProd(p).toUpperCase()}
                    </span>
                    {p.es_por_tapa && Number(p.subtotal) === 0
                      ? <span className="whitespace-nowrap">INCLUIDO</span>
                      : <span className="whitespace-nowrap">{fmtMonto(p.subtotal)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Corte />

          {/* Totales */}
          <div className="mb-5">
            {Number(nota.ajuste) !== 0 && nota.ajuste != null && (
              <Linea label="Ajuste" value={`${Number(nota.ajuste) > 0 ? '+' : ''}${fmtMonto(nota.ajuste)}`} />
            )}
            <div className="flex items-baseline justify-between gap-2 text-sm font-bold">
              <span>TOTAL M.N.</span>
              <span className="whitespace-nowrap">{fmtMonto(nota.precio_total)}</span>
            </div>
          </div>

          <Asteriscos />

          {/* Pie */}
          <p className="text-center">¡GRACIAS POR SU PREFERENCIA!</p>

          {/* Nota del negocio (Ajustes → Ticket): la letra chica del recibo */}
          {notaPie && (
            <p className="mt-3 whitespace-pre-line text-center text-[10px] leading-relaxed">
              {notaPie}
            </p>
          )}
        </div>
        </div>

        {/* Teléfono para WhatsApp: si la nota no tiene cliente (Autoservicio
            anónimo), se captura a mano aquí. */}
        {!nota.cliente_telefono && (
          <div>
            <label htmlFor="telefono-ticket" className="block text-sm font-medium text-gray-700 mb-1.5">
              Teléfono para enviar el ticket
            </label>
            <input
              id="telefono-ticket"
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
          disabled={!puedeEnviar || enviando}
          title={puedeEnviar ? 'Mandar el ticket en imagen' : 'Escribe un teléfono válido (10 dígitos)'}
          className="w-full flex items-center justify-center gap-2 bg-[#27A910] hover:bg-[#218f0d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-lg text-base transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 19 19">
            <path d="M16.2312 2.76454C15.3557 1.88495 14.313 1.18752 13.164 0.712894C12.0149 0.238271 10.7823 -0.00405 9.53819 5.12002e-05C4.32513 5.12002e-05 0.0763821 4.22754 0.0763821 9.41453C0.0763821 11.077 0.515578 12.692 1.33668 14.117L0 19L5.01256 17.689C6.39698 18.4395 7.95327 18.8385 9.53819 18.8385C14.7513 18.8385 19 14.611 19 9.42403C19 6.90653 18.0166 4.54104 16.2312 2.76454ZM9.53819 17.2425C8.12512 17.2425 6.7407 16.8625 5.52814 16.15L5.24171 15.979L2.26281 16.758L3.05528 13.87L2.86432 13.5755C2.07907 12.3282 1.66219 10.8863 1.66131 9.41453C1.66131 5.10154 5.19397 1.58655 9.52864 1.58655C11.6291 1.58655 13.6055 2.40354 15.0854 3.88554C15.8183 4.61121 16.3991 5.47445 16.7941 6.4252C17.1891 7.37594 17.3904 8.39526 17.3864 9.42403C17.4055 13.737 13.8729 17.2425 9.53819 17.2425ZM13.8538 11.3905C13.6151 11.2765 12.4503 10.7065 12.2402 10.621C12.0206 10.545 11.8678 10.507 11.7055 10.735C11.5432 10.9725 11.0945 11.5045 10.9608 11.6565C10.8271 11.818 10.6839 11.837 10.4452 11.7135C10.2065 11.5995 9.44271 11.343 8.54523 10.545C7.83869 9.91803 7.37085 9.14853 7.22764 8.91103C7.09397 8.67353 7.20854 8.55003 7.33266 8.42653C7.43769 8.32203 7.57136 8.15103 7.68593 8.01803C7.8005 7.88503 7.84824 7.78053 7.92462 7.62853C8.001 7.46703 7.96281 7.33403 7.90553 7.22003C7.84824 7.10603 7.37085 5.94704 7.1799 5.47204C6.98894 5.01604 6.78844 5.07304 6.64523 5.06354H6.18693C6.02462 5.06354 5.77638 5.12054 5.55678 5.35804C5.34673 5.59554 4.73568 6.16554 4.73568 7.32453C4.73568 8.48353 5.58543 9.60453 5.7 9.75653C5.81457 9.91803 7.37085 12.293 9.73869 13.3095C10.302 13.5565 10.7412 13.699 11.0849 13.8035C11.6482 13.984 12.1638 13.9555 12.5744 13.8985C13.0327 13.832 13.9779 13.3285 14.1688 12.7775C14.3693 12.2265 14.3693 11.761 14.3025 11.6565C14.2357 11.552 14.0925 11.5045 13.8538 11.3905Z" />
          </svg>
          {enviando ? 'Preparando el ticket…' : 'Enviar por WhatsApp'}
        </button>

        {avisoEnvio && (
          <p className="text-xs text-gray-500 text-center -mt-3">{avisoEnvio}</p>
        )}
      </div>
    </div>
  );
}
