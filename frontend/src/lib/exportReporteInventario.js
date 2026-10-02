// Exportación del "Reporte diario" de Inventario a CSV (Excel) y a PDF.
// Ver exportUtils.js (piezas compartidas) y formatoInventario.js (opción B).
//
// Recibe { fecha: 'YYYY-MM-DD', productos: [...] } de GET /productos/reporte-diario.

import { slug, esc, descargarCSV, imprimirDocumento, fechaLarga } from './exportUtils';
import { textoBotellas, textoGranel, seVendePorUnidad, esPolvo } from './formatoInventario';

// 'YYYY-MM-DD' → Date local (sin corrimiento por zona horaria).
const fechaLocal = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Para el reporte, lo que se cuenta por unidades (marca y polvo) se lee igual:
// sin botellas ni bidón detrás.
const esMarca  = (p) => seVendePorUnidad(p);
const nombreProd = (p) => (esMarca(p) && p.marca ? `${p.marca} · ${p.nombre}` : p.nombre);

const salioTexto = (p) => textoBotellas(p.vendido_medidas, p.medidas_por_botella, { marca: esMarca(p) });
// Ventas anuladas ese día (ya restadas de "Salió"): van en su propia columna
// para que el total no parezca un error de captura.
const devueltoTexto = (p) =>
  (p.devuelto_medidas > 0 ? textoBotellas(p.devuelto_medidas, p.medidas_por_botella, { marca: esMarca(p) }) : '');
const rellenadasTexto = (p) => textoBotellas(p.fin_botellas_medidas, p.medidas_por_botella, { marca: esMarca(p) });
const granelTexto = (p) => (esMarca(p) ? '' : textoGranel(p.fin_granel_medidas, p.medidas_por_bidon, p.medidas_por_botella));

// ── CSV ─────────────────────────────────────────────────────
const ENCABEZADOS_CSV = ['Tipo', 'Marca', 'Producto', 'Salió', 'Devuelto', 'Queda (rellenadas)', 'Queda (a granel)'];

const filaCSV = (p) => [
  esPolvo(p) ? 'Polvo' : esMarca(p) ? 'Marca' : 'Granel',
  p.marca ?? '',
  p.nombre ?? '',
  salioTexto(p),
  devueltoTexto(p),
  rellenadasTexto(p),
  granelTexto(p),
];

export function descargarReporteCSV(data) {
  const productos = data?.productos ?? [];
  descargarCSV(`inventario-${slug(data?.fecha)}`, ENCABEZADOS_CSV, productos.map(filaCSV));
}

// ── PDF (impresión del navegador) ───────────────────────────
const quedaCelda = (p) =>
  esMarca(p)
    ? esc(rellenadasTexto(p))
    : `Rellenadas: ${esc(rellenadasTexto(p))}<br>A granel: ${esc(granelTexto(p))}`;

const seccion = (titulo, productos) => {
  if (productos.length === 0) return '';
  const filas = productos.map((p) => `
    <tr>
      <td>${esc(nombreProd(p))}</td>
      <td>${esc(salioTexto(p))}${p.devuelto_medidas > 0 ? `<br><small>Devuelto: ${esc(devueltoTexto(p))}</small>` : ''}</td>
      <td>${quedaCelda(p)}</td>
    </tr>`).join('');
  return `
    <div class="seccion">${esc(titulo)}</div>
    <table class="resumen">
      <thead>
        <tr><th>Producto</th><th>Salió</th><th>Queda al final</th></tr>
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
    : seccion('Granel', granel) + seccion('Polvo', polvo) + seccion('Marca', marca);
  imprimirDocumento({
    titulo: 'Reporte diario de inventario',
    subtitulo: fechaLarga(fechaLocal(data.fecha)),
    cuerpo,
  });
}
