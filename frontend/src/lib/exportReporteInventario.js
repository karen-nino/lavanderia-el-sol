// Exportación del "Reporte diario" de Inventario a CSV (Excel) y a PDF.
// Ver exportUtils.js (piezas compartidas) y formatoInventario.js (opción B).
//
// Recibe { fecha: 'YYYY-MM-DD', productos: [...] } de GET /productos/reporte-diario.

import { slug, esc, descargarCSV, imprimirDocumento, fechaLarga } from './exportUtils';
import { textoBotellas, textoGranel } from './formatoInventario';

// 'YYYY-MM-DD' → Date local (sin corrimiento por zona horaria).
const fechaLocal = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const esMarca  = (p) => p.tipo_liquido === 'marca';
const nombreProd = (p) => (esMarca(p) && p.marca ? `${p.marca} · ${p.nombre}` : p.nombre);

const salioTexto = (p) => textoBotellas(p.vendido_tapas, p.tapas_por_botella, { marca: esMarca(p) });
const rellenadasTexto = (p) => textoBotellas(p.fin_botellas_tapas, p.tapas_por_botella, { marca: esMarca(p) });
const granelTexto = (p) => (esMarca(p) ? '' : textoGranel(p.fin_granel_tapas, p.tapas_por_bidon, p.tapas_por_botella));

// ── CSV ─────────────────────────────────────────────────────
const ENCABEZADOS_CSV = ['Tipo', 'Marca', 'Producto', 'Salió', 'Queda (rellenadas)', 'Queda (a granel)'];

const filaCSV = (p) => [
  esMarca(p) ? 'Marca' : 'Granel',
  p.marca ?? '',
  p.nombre ?? '',
  salioTexto(p),
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
      <td>${esc(salioTexto(p))}</td>
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
  const marca  = productos.filter(esMarca);
  const cuerpo = productos.length === 0
    ? '<p>Sin productos líquidos en este período.</p>'
    : seccion('Granel', granel) + seccion('Marca', marca);
  imprimirDocumento({
    titulo: 'Reporte diario de inventario',
    subtitulo: fechaLarga(fechaLocal(data.fecha)),
    cuerpo,
  });
}
