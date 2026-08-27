// Exportación de cortes de caja a CSV (Excel) y a PDF (vía la impresión del
// navegador). Sin dependencias: el CSV se descarga como Blob y el PDF se arma
// en una ventana nueva con HTML propio y se manda a imprimir.
//
// La forma de cada `corte` es la que devuelve GET /caja/historial:
//   { usuario_apertura, usuario_cierre, abierta_at, cerrada_at,
//     notas_apertura, notas_cierre, monto_inicial, ventas, entradas,
//     salidas, esperado, contado, diferencia }

import { formatHora12 } from './fecha';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const fmtMoneda = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);

// Número plano con dos decimales y punto (Excel es-MX lo lee como número).
const num = (n) => Number(n ?? 0).toFixed(2);

// "Lunes, 03 Ago 2026"
const fechaLarga = (fecha) => {
  if (!fecha) return '—';
  const d = new Date(fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${DIAS[d.getDay()]}, ${dd} ${MESES_CORTOS[d.getMonth()]} ${d.getFullYear()}`;
};

// "2026-08-27" (para nombres de archivo y columna de CSV).
const fechaISO = (fecha) => {
  if (!fecha) return '';
  const d = new Date(fecha);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Estado del corte según su diferencia.
const estadoCorte = (c) => {
  if (c.contado == null || c.diferencia == null) return '';
  if (Math.abs(c.diferencia) < 0.005) return 'Cuadra';
  return c.diferencia < 0 ? 'Faltante' : 'Sobrante';
};

// Convierte un texto en algo apto para nombre de archivo.
const slug = (s) =>
  (s || 'cortes')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'cortes';

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

const ENCABEZADOS_CSV = [
  'Fecha', 'Hora', 'Abrió', 'Cerró', 'Fondo inicial', 'Ventas',
  'Entradas', 'Salidas', 'Esperado', 'Contado', 'Diferencia',
  'Estado', 'Nota apertura', 'Nota cierre',
];

const filaCSV = (c) =>
  [
    fechaISO(c.cerrada_at),
    formatHora12(c.cerrada_at),
    c.usuario_apertura ?? '',
    c.usuario_cierre ?? '',
    num(c.monto_inicial),
    num(c.ventas),
    num(c.entradas),
    num(c.salidas),
    num(c.esperado),
    c.contado != null ? num(c.contado) : '',
    c.diferencia != null ? num(c.diferencia) : '',
    estadoCorte(c),
    c.notas_apertura ?? '',
    c.notas_cierre ?? '',
  ].map(csvCell).join(',');

// Descarga uno o varios cortes como CSV. `sufijo` va en el nombre del archivo.
export function descargarCortesCSV(cortes, sufijo) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  const filas = lista.map(filaCSV);
  // BOM para que Excel respete los acentos (UTF-8).
  const csv = '﻿' + [ENCABEZADOS_CSV.join(','), ...filas].join('\r\n');
  descargarArchivo(`cortes-${slug(sufijo)}.csv`, csv, 'text/csv;charset=utf-8;');
}

// ── PDF (impresión del navegador) ───────────────────────────
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const claseDif = (c) => {
  if (c.contado == null || c.diferencia == null) return '';
  if (Math.abs(c.diferencia) < 0.005) return 'ok';
  return c.diferencia < 0 ? 'neg' : 'pos';
};

const textoDif = (c) => {
  if (c.contado == null || c.diferencia == null) return '—';
  if (Math.abs(c.diferencia) < 0.005) return 'Cuadra';
  const signo = c.diferencia > 0 ? '+' : '';
  const etiqueta = c.diferencia < 0 ? 'faltante' : 'sobrante';
  return `${signo}${fmtMoneda(c.diferencia)} (${etiqueta})`;
};

// Bloque detallado de un corte (encabezado + desglose + firmas).
const bloqueDetalle = (c) => `
  <section class="corte">
    <div class="corte-head">
      <h2>${esc(fechaLarga(c.cerrada_at))}</h2>
      <span class="hora">${esc(formatHora12(c.cerrada_at))}</span>
    </div>
    <table class="desglose">
      <tbody>
        <tr><td>Fondo inicial</td><td class="r">${fmtMoneda(c.monto_inicial)}</td></tr>
        <tr><td>Ventas cobradas</td><td class="r">${fmtMoneda(c.ventas)}</td></tr>
        <tr><td>Entradas</td><td class="r">${fmtMoneda(c.entradas)}</td></tr>
        <tr><td>Salidas</td><td class="r">${fmtMoneda(c.salidas)}</td></tr>
        <tr class="tot"><td>Esperado en caja</td><td class="r">${fmtMoneda(c.esperado)}</td></tr>
        <tr><td>Efectivo contado</td><td class="r">${c.contado != null ? fmtMoneda(c.contado) : '—'}</td></tr>
        <tr class="dif ${claseDif(c)}"><td>Diferencia</td><td class="r">${textoDif(c)}</td></tr>
      </tbody>
    </table>
    <div class="firmas">
      <div><span class="lbl">Abrió</span> ${esc(c.usuario_apertura || '—')}
        ${c.notas_apertura ? `<p class="nota">${esc(c.notas_apertura)}</p>` : ''}</div>
      <div><span class="lbl">Cerró</span> ${esc(c.usuario_cierre || '—')}
        ${c.notas_cierre ? `<p class="nota">${esc(c.notas_cierre)}</p>` : ''}</div>
    </div>
  </section>`;

// Tabla resumen (una fila por corte) + totales, para varios cortes.
const tablaResumen = (cortes) => {
  const suma = (k) => cortes.reduce((a, c) => a + Number(c[k] ?? 0), 0);
  const filas = cortes.map((c) => `
    <tr>
      <td>${esc(fechaLarga(c.cerrada_at))}</td>
      <td class="r">${fmtMoneda(c.monto_inicial)}</td>
      <td class="r">${fmtMoneda(c.ventas)}</td>
      <td class="r">${fmtMoneda(c.entradas)}</td>
      <td class="r">${fmtMoneda(c.salidas)}</td>
      <td class="r">${fmtMoneda(c.esperado)}</td>
      <td class="r">${c.contado != null ? fmtMoneda(c.contado) : '—'}</td>
      <td class="r ${claseDif(c)}">${c.diferencia != null
        ? (Math.abs(c.diferencia) < 0.005 ? 'Cuadra' : `${c.diferencia > 0 ? '+' : ''}${fmtMoneda(c.diferencia)}`)
        : '—'}</td>
    </tr>`).join('');
  const difTotal = cortes.some((c) => c.diferencia != null) ? suma('diferencia') : null;
  return `
    <table class="resumen">
      <thead>
        <tr>
          <th>Fecha</th><th class="r">Fondo</th><th class="r">Ventas</th>
          <th class="r">Entradas</th><th class="r">Salidas</th><th class="r">Esperado</th>
          <th class="r">Contado</th><th class="r">Diferencia</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td>Totales (${cortes.length} ${cortes.length === 1 ? 'corte' : 'cortes'})</td>
          <td class="r">${fmtMoneda(suma('monto_inicial'))}</td>
          <td class="r">${fmtMoneda(suma('ventas'))}</td>
          <td class="r">${fmtMoneda(suma('entradas'))}</td>
          <td class="r">${fmtMoneda(suma('salidas'))}</td>
          <td class="r">${fmtMoneda(suma('esperado'))}</td>
          <td class="r">${cortes.some((c) => c.contado != null) ? fmtMoneda(suma('contado')) : '—'}</td>
          <td class="r">${difTotal != null
            ? (Math.abs(difTotal) < 0.005 ? 'Cuadra' : `${difTotal > 0 ? '+' : ''}${fmtMoneda(difTotal)}`)
            : '—'}</td>
        </tr>
      </tfoot>
    </table>`;
};

const documentoHTML = (cortes, titulo, subtitulo) => {
  const cuerpo = cortes.length === 1
    ? bloqueDetalle(cortes[0])
    : tablaResumen(cortes);
  const impreso = formatFechaImpresion();
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1f2937; margin: 0; padding: 32px; }
  header { border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
  header .marca { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: #2563eb; font-weight: 700; }
  header h1 { font-size: 22px; margin: 4px 0 2px; }
  header .sub { color: #6b7280; font-size: 13px; }
  h2 { font-size: 16px; margin: 0; }
  .corte { margin-bottom: 28px; page-break-inside: avoid; }
  .corte-head { display: flex; justify-content: space-between; align-items: baseline;
                border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; }
  .corte-head .hora { color: #6b7280; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .desglose td { padding: 8px 4px; border-bottom: 1px solid #f3f4f6; }
  .desglose .tot td { font-weight: 700; border-top: 1px solid #d1d5db; }
  .desglose .dif td { font-weight: 700; }
  .r { text-align: right; }
  .ok { color: #2563eb; } .neg { color: #dc2626; } .pos { color: #16a34a; }
  .firmas { display: flex; gap: 32px; margin-top: 16px; font-size: 13px; }
  .firmas .lbl { display: block; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: #9ca3af; }
  .firmas .nota { margin: 6px 0 0; color: #6b7280; border-left: 2px solid #e5e7eb; padding-left: 8px; }
  .resumen th, .resumen td { padding: 8px 6px; border-bottom: 1px solid #f3f4f6; }
  .resumen thead th { text-align: left; border-bottom: 2px solid #e5e7eb; color: #6b7280;
                      font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .resumen tfoot td { font-weight: 700; border-top: 2px solid #d1d5db; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #f3f4f6;
           color: #9ca3af; font-size: 11px; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
</style></head>
<body>
  <header>
    <div class="marca">Lavandería El Sol</div>
    <h1>${esc(titulo)}</h1>
    ${subtitulo ? `<div class="sub">${esc(subtitulo)}</div>` : ''}
  </header>
  ${cuerpo}
  <footer>Generado el ${esc(impreso)}</footer>
</body></html>`;
};

const formatFechaImpresion = () => {
  const d = new Date();
  return `${fechaLarga(d)} a las ${formatHora12(d)}`;
};

// Abre una ventana con el/los corte(s) y lanza la impresión (Guardar como PDF).
export function imprimirCortes(cortes, { titulo, subtitulo } = {}) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  if (lista.length === 0) return;
  const win = window.open('', '_blank');
  if (!win) {
    alert('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para exportar a PDF.');
    return;
  }
  win.document.write(documentoHTML(lista, titulo || 'Corte de caja', subtitulo));
  win.document.close();
  win.focus();
  // Esperar a que renderice antes de imprimir.
  const lanzar = () => { try { win.print(); } catch { /* ventana cerrada */ } };
  if (win.document.readyState === 'complete') setTimeout(lanzar, 200);
  else win.onload = () => setTimeout(lanzar, 200);
}
