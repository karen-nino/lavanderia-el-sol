/**
 * Piezas compartidas para exportar a Excel (archivo descargado) y PDF (ventana con
 * HTML propio que se manda a imprimir). Sin dependencias.
 */

import { formatHora12 } from './fecha';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const fmtMoneda = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);


// "Lunes, 03 Ago 2026"
export const fechaLarga = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${DIAS[d.getDay()]}, ${dd} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
};

// "2026-08-27" (para nombres de archivo y fechas del Excel).
export const fechaISO = (fecha) => {
  if (!fecha) return '';
  const d = new Date(fecha);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Convierte un texto en algo apto para nombre de archivo.
export const slug = (s) =>
  (s || 'export')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'export';

// Descarga un archivo hecho en el navegador (Excel de los reportes).
export const descargarArchivo = (nombre, contenido, mime) => {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ── PDF (impresión del navegador) ───────────────────────────
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatFechaImpresion = () => `${fechaLarga(new Date())} a las ${formatHora12(new Date())}`;

// Hoja de estilos común para los documentos imprimibles (cortes, ventas e inventario).
const ESTILOS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1a2230; margin: 0; padding: 32px; font-size: 14px; line-height: 1.45;
         font-variant-numeric: tabular-nums; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
           border-bottom: 2px solid #1a2230; padding-bottom: 14px; margin-bottom: 24px; }
  header .marca { font-size: 14px; color: #1b3a5c; font-weight: 700; }
  header h1 { font-size: 24px; margin: 2px 0 0; letter-spacing: -0.01em; }
  header .sub { color: #4a5565; font-size: 13.5px; text-align: right; }
  h2 { font-size: 16px; margin: 0; }
  .seccion { font-size: 15px; font-weight: 700; margin: 28px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .r { text-align: right; }
  .ok { color: #2563eb; } .neg { color: #b42318; } .pos { color: #1f7a41; }
  /* Corte: cifras del cierre arriba, Ingresos | Egresos y movimientos, firmas */
  .corte { margin-bottom: 36px; font-variant-numeric: tabular-nums; }
  .corte-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
                border-bottom: 1px solid #d9dee5; padding-bottom: 8px; margin-bottom: 16px; }
  .corte-head .hora { color: #4a5565; font-size: 13px; }
  .corte .seccion { font-size: 15px; margin: 0 0 6px; }
  .cifras { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #d9dee5;
            border-radius: 8px; margin-bottom: 24px; page-break-inside: avoid; }
  .cifras > div { padding: 11px 14px; border-left: 1px solid #d9dee5; }
  .cifras > div:first-child { border-left: 0; }
  .cifras p { margin: 0; }
  .cifras .k { font-size: 13px; color: #4a5565; }
  .cifras .v { font-size: 20px; font-weight: 700; margin-top: 2px; white-space: nowrap; }
  .cifras .s { font-size: 12.5px; color: #4a5565; margin-top: 1px; }
  .cifras .falta { background: #fdecea; } .cifras .falta .k, .cifras .falta .v, .cifras .falta .s { color: #b42318; }
  .cifras .sobra { background: #e6f4ec; } .cifras .sobra .k, .cifras .sobra .v, .cifras .sobra .s { color: #1f7a41; }
  .cifras .cuadra .v { color: #1f7a41; }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
  .dos table + .seccion { margin-top: 24px; }
  .desglose td { padding: 7px 0; border-bottom: 1px solid #eceff3; vertical-align: baseline; }
  .desglose .tot td { font-weight: 700; font-size: 14px; border-top: 2px solid #1f2937; border-bottom: none; padding-top: 9px; }
  .desglose .subtot td { font-weight: 700; border-bottom: 1px solid #d9dee5; }
  .desglose .dif td { font-weight: 700; }
  /* Encabezado de subgrupo dentro de un desglose (p. ej. "Por concepto"). */
  .desglose .sub td { padding-top: 14px; font-weight: 600; color: #1b3a5c; border-bottom: 1px solid #d9dee5; }
  .desglose .nota { display: block; font-size: 12px; color: #4a5565; }
  .desglose .nota td { padding-top: 6px; font-size: 12px; color: #4a5565; border-bottom: none; }
  .movs th { text-align: left; font-size: 12.5px; font-weight: 600; color: #4a5565;
             border-bottom: 1px solid #1f2937; padding: 6px 0; }
  .movs th.r { text-align: right; }
  .movs td { padding: 7px 0; border-bottom: 1px solid #eceff3; vertical-align: baseline; }
  .movs td.hora { width: 76px; white-space: nowrap; padding-right: 8px; }
  .movs .quien { display: block; font-size: 12px; color: #4a5565; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; font-size: 13px;
            page-break-inside: avoid; }
  .firma .rayita { border-bottom: 1px solid #1f2937; height: 34px; }
  .firma p { margin: 6px 0 0; }
  .firma .rol { color: #4a5565; }
  .firma .obs { color: #4a5565; }
  .resumen th, .resumen td { padding: 7px 6px; border-bottom: 1px solid #eceff3; vertical-align: baseline; }
  .resumen th:first-child, .resumen td:first-child { padding-left: 0; }
  .resumen th:last-child, .resumen td:last-child { padding-right: 0; }
  .resumen thead th { text-align: left; border-bottom: 1px solid #1a2230; color: #4a5565;
                      font-size: 12.5px; font-weight: 600; }
  .resumen thead th.r { text-align: right; }
  .resumen tfoot td { font-weight: 700; border-top: 2px solid #1a2230; border-bottom: none; }
  .resumen tr.cancelada td { color: #6b7280; }
  .resumen tr.pendiente td { background: #fffbeb; }
  .resumen .tachado { text-decoration: line-through; }
  .resumen .chip { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700;
                   color: #b45309; background: #fef3c7; border-radius: 9999px; padding: 1px 6px; }
  .aviso { font-size: 12.5px; color: #4a5565; margin: 0 0 10px; }
  footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 32px; padding-top: 10px;
           border-top: 1px solid #d9dee5; color: #4a5565; font-size: 12px; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
`;

// Abre una ventana con el documento (cabecera + cuerpo HTML) y lanza la
// impresión (Guardar como PDF). `cuerpo` es HTML ya escapado por quien lo arma.
export function imprimirDocumento({ titulo, subtitulo, cuerpo }) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para exportar a PDF.');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>${ESTILOS}</style></head>
<body>
  <header>
    <div>
      <div class="marca">Lavandería El Sol</div>
      <h1>${esc(titulo)}</h1>
    </div>
    ${subtitulo ? `<div class="sub">${esc(subtitulo)}</div>` : ''}
  </header>
  ${cuerpo}
  <footer><span>Lavandería El Sol</span><span>Generado el ${esc(formatFechaImpresion())}</span></footer>
</body></html>`);
  win.document.close();
  win.focus();
  const lanzar = () => { try { win.print(); } catch { /* ventana cerrada */ } };
  if (win.document.readyState === 'complete') setTimeout(lanzar, 200);
  else win.onload = () => setTimeout(lanzar, 200);
}
