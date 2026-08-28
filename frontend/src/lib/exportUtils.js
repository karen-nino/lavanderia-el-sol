// Utilidades compartidas para exportar a CSV (Excel) y a PDF (vía la impresión
// del navegador). Sin dependencias: el CSV se descarga como Blob y el PDF se
// arma en una ventana nueva con HTML propio y se manda a imprimir.
// Lo usan exportCorte.js (cortes de caja) y exportVentas.js (reporte de ventas).

import { formatHora12 } from './fecha';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const fmtMoneda = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

// Número plano con dos decimales y punto (Excel es-MX lo lee como número).
export const num = (n) => Number(n ?? 0).toFixed(2);

// "Lunes, 03 Ago 2026"
export const fechaLarga = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${DIAS[d.getDay()]}, ${dd} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
};

// "2026-08-27" (para nombres de archivo y columnas de CSV).
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

// ── CSV ─────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const descargarArchivo = (nombre, contenido, mime) => {
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

// Descarga un CSV a partir de encabezados (array) y filas (array de arrays).
// `nombreBase` no lleva extensión ni sufijo de archivo.
export function descargarCSV(nombreBase, encabezados, filas) {
  const lineas = [encabezados, ...filas].map((f) => f.map(csvCell).join(','));
  // BOM para que Excel respete los acentos (UTF-8).
  const csv = '﻿' + lineas.join('\r\n');
  descargarArchivo(`${nombreBase}.csv`, csv, 'text/csv;charset=utf-8;');
}

// ── PDF (impresión del navegador) ───────────────────────────
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatFechaImpresion = () => `${fechaLarga(new Date())} a las ${formatHora12(new Date())}`;

// Hoja de estilos común para los documentos imprimibles (cortes y ventas).
const ESTILOS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1f2937; margin: 0; padding: 32px; }
  header { border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
  header .marca { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: #2563eb; font-weight: 700; }
  header h1 { font-size: 22px; margin: 4px 0 2px; }
  header .sub { color: #6b7280; font-size: 13px; }
  h2 { font-size: 16px; margin: 0; }
  .seccion { font-size: 14px; font-weight: 700; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .r { text-align: right; }
  .ok { color: #2563eb; } .neg { color: #dc2626; } .pos { color: #16a34a; }
  /* Corte */
  .corte { margin-bottom: 28px; page-break-inside: avoid; }
  .corte-head { display: flex; justify-content: space-between; align-items: baseline;
                border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; }
  .corte-head .hora { color: #6b7280; font-size: 13px; }
  .desglose td { padding: 8px 4px; border-bottom: 1px solid #f3f4f6; }
  .desglose .tot td { font-weight: 700; border-top: 1px solid #d1d5db; }
  .desglose .dif td { font-weight: 700; }
  .firmas { display: flex; gap: 32px; margin-top: 16px; font-size: 13px; }
  .firmas .lbl { display: block; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: #9ca3af; }
  .firmas .nota { margin: 6px 0 0; color: #6b7280; border-left: 2px solid #e5e7eb; padding-left: 8px; }
  .resumen th, .resumen td { padding: 8px 6px; border-bottom: 1px solid #f3f4f6; }
  .resumen thead th { text-align: left; border-bottom: 2px solid #e5e7eb; color: #6b7280;
                      font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .resumen tfoot td { font-weight: 700; border-top: 2px solid #d1d5db; }
  .resumen tr.cancelada td { color: #9ca3af; }
  .resumen tr.pendiente td { background: #fffbeb; }
  .resumen .tachado { text-decoration: line-through; }
  .resumen .chip { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700;
                   color: #b45309; background: #fef3c7; border-radius: 9999px; padding: 1px 6px; }
  .aviso { font-size: 11px; color: #9ca3af; margin: 0 0 10px; }
  /* Ventas */
  .tarjetas { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
  .tarjeta { flex: 1; min-width: 150px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .tarjeta .t { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .tarjeta .v { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .tarjeta .s { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #f3f4f6;
           color: #9ca3af; font-size: 11px; }
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
    <div class="marca">Lavandería El Sol</div>
    <h1>${esc(titulo)}</h1>
    ${subtitulo ? `<div class="sub">${esc(subtitulo)}</div>` : ''}
  </header>
  ${cuerpo}
  <footer>Generado el ${esc(formatFechaImpresion())}</footer>
</body></html>`);
  win.document.close();
  win.focus();
  const lanzar = () => { try { win.print(); } catch { /* ventana cerrada */ } };
  if (win.document.readyState === 'complete') setTimeout(lanzar, 200);
  else win.onload = () => setTimeout(lanzar, 200);
}
