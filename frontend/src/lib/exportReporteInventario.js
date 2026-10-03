// Exportación del "Reporte diario" de Inventario a CSV (Excel) y a PDF.
// Ver exportUtils.js (piezas compartidas) y formatoInventario.js (opción B).
//
// Recibe { fecha: 'YYYY-MM-DD', productos: [...] } de GET /productos/reporte-diario.

import { slug, esc, descargarCSV, imprimirDocumento, fechaLarga } from './exportUtils';
import { textoBotellas, textoGranel, seVendePorUnidad, esPolvo, lineasEntradas, lineasSalidas, lineasDevuelto } from './formatoInventario';

// 'YYYY-MM-DD' → Date local (sin corrimiento por zona horaria).
const fechaLocal = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Para el reporte, lo que se cuenta por unidades (marca y polvo) se lee igual:
// sin botellas ni bidón detrás.
const esMarca  = (p) => seVendePorUnidad(p);
const nombreProd = (p) => (esMarca(p) && p.marca ? `${p.marca} · ${p.nombre}` : p.nombre);

const entradasLineas = (p) => lineasEntradas(p, esMarca(p));
// Salidas: por notas más las manuales (merma, dañado…).
const salidasLineas = (p) => lineasSalidas(p, esMarca(p));
// Ventas anuladas ese día: van en su propia columna (Salidas ya no las resta)
// para que el total no parezca un error de captura.
const devueltoTexto = (p) => lineasDevuelto(p, esMarca(p)).join(' · ');
const inicioRellenadas = (p) => textoBotellas(p.inicio_botellas_medidas, p.medidas_por_botella, { marca: esMarca(p) });
const inicioGranel = (p) => (esMarca(p) ? '' : textoGranel(p.inicio_granel_medidas, p.medidas_por_bidon, p.medidas_por_botella));
const rellenadasTexto = (p) => textoBotellas(p.fin_botellas_medidas, p.medidas_por_botella, { marca: esMarca(p) });
const granelTexto = (p) => (esMarca(p) ? '' : textoGranel(p.fin_granel_medidas, p.medidas_por_bidon, p.medidas_por_botella));

// Devuelto solo va el día que algún producto tuvo algo devuelto, igual que en
// la pantalla.
const hayDevuelto = (productos) => productos.some((p) => Number(p.devuelto_medidas) > 0);

// ── CSV ─────────────────────────────────────────────────────
const encabezadosCSV = (conDevuelto) => [
  'Tipo', 'Marca', 'Producto', 'Entradas', 'Salidas',
  ...(conDevuelto ? ['Devuelto'] : []),
  'Había (rellenadas)', 'Había (a granel)', 'Queda (rellenadas)', 'Queda (a granel)',
];

const filaCSV = (p, conDevuelto) => [
  esPolvo(p) ? 'Polvo' : esMarca(p) ? 'Marca' : 'Granel',
  p.marca ?? '',
  p.nombre ?? '',
  entradasLineas(p).join(' · '),
  salidasLineas(p).join(' · '),
  ...(conDevuelto ? [devueltoTexto(p)] : []),
  inicioRellenadas(p),
  inicioGranel(p),
  rellenadasTexto(p),
  granelTexto(p),
];

export function descargarReporteCSV(data) {
  const productos = data?.productos ?? [];
  const conDevuelto = hayDevuelto(productos);
  descargarCSV(`inventario-${slug(data?.fecha)}`, encabezadosCSV(conDevuelto),
    productos.map((p) => filaCSV(p, conDevuelto)));
}

// ── PDF (impresión del navegador) ───────────────────────────
const quedaCelda = (p) =>
  esMarca(p)
    ? esc(rellenadasTexto(p))
    : `Rellenadas: ${esc(rellenadasTexto(p))}<br>A granel: ${esc(granelTexto(p))}`;
const inicioCelda = (p) =>
  esMarca(p)
    ? esc(inicioRellenadas(p))
    : `Rellenadas: ${esc(inicioRellenadas(p))}<br>A granel: ${esc(inicioGranel(p))}`;

const seccion = (titulo, productos, conDevuelto) => {
  if (productos.length === 0) return '';
  const filas = productos.map((p) => `
    <tr>
      <td>${esc(nombreProd(p))}</td>
      <td>${entradasLineas(p).map(esc).join('<br>')}</td>
      <td>${salidasLineas(p).map(esc).join('<br>')}</td>
      ${conDevuelto ? `<td>${esc(devueltoTexto(p))}</td>` : ''}
      <td>${inicioCelda(p)}</td>
      <td>${quedaCelda(p)}</td>
    </tr>`).join('');
  return `
    <div class="seccion">${esc(titulo)}</div>
    <table class="resumen">
      <thead>
        <tr><th>Producto</th><th>Entradas</th><th>Salidas</th>${conDevuelto ? '<th>Devuelto</th>' : ''}<th>Había al inicio</th><th>Queda al final</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
};

export function imprimirReporte(data) {
  if (!data) return;
  const productos = data.productos ?? [];
  const granel = productos.filter((p) => !esMarca(p));
  const polvo  = productos.filter(esPolvo);
  const marca  = productos.filter((p) => esMarca(p) && !esPolvo(p));
  const cuerpo = productos.length === 0
    ? '<p>Sin productos líquidos en este período.</p>'
    : (() => {
        const conDevuelto = hayDevuelto(productos);
        return seccion('Granel', granel, conDevuelto) + seccion('Polvo', polvo, conDevuelto)
          + seccion('Marca', marca, conDevuelto);
      })();
  imprimirDocumento({
    titulo: 'Reporte diario de inventario',
    subtitulo: fechaLarga(fechaLocal(data.fecha)),
    cuerpo,
  });
}
