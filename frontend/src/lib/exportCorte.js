// Exportación de cortes de caja a CSV (Excel) y a PDF. Ver exportUtils.js para
// las piezas compartidas (descarga de CSV, ventana de impresión, formatos).
//
// La forma de cada `corte` es la que devuelve GET /caja/historial:
//   { usuario_apertura, usuario_cierre, abierta_at, cerrada_at,
//     notas_apertura, notas_cierre, monto_inicial, ventas, entradas,
//     salidas, esperado, contado, diferencia,
//     movimientos: [{ tipo, concepto, monto, usuario, created_at }] }
//
// Las entradas y salidas van con su concepto en todas las exportaciones
// (2026-10-04): en el CSV como una segunda tabla debajo de los cortes, una fila
// por movimiento, y en el PDF como tabla.

import { formatHora12 } from './fecha';
import {
  fmtMoneda, num, fechaLarga, fechaISO, slug, esc,
  descargarCSV, imprimirDocumento,
} from './exportUtils';

// Estado del corte según su diferencia.
const estadoCorte = (c) => {
  if (c.contado == null || c.diferencia == null) return '';
  if (Math.abs(c.diferencia) < 0.005) return 'Cuadra';
  return c.diferencia < 0 ? 'Faltante' : 'Sobrante';
};

// ── CSV ─────────────────────────────────────────────────────
const ENCABEZADOS_CSV = [
  'Fecha', 'Hora', 'Abrió', 'Cerró', 'Fondo inicial', 'Ventas', 'Ventas efectivo', 'Transferencia', 'Tarjeta',
  'Entradas', 'Salidas', 'Esperado', 'Contado', 'Diferencia',
  'Estado', 'Nota apertura', 'Nota cierre',
];

// Segunda tabla del CSV: una fila por entrada o salida, con el corte al que
// pertenece. La salida va en negativo para que en Excel se pueda sumar.
const ENCABEZADOS_MOVS = ['Corte', 'Fecha', 'Hora', 'Tipo', 'Concepto', 'Registró', 'Monto'];

const filasMovimientos = (c) => (c.movimientos ?? []).map((m) => [
  `${fechaISO(c.cerrada_at)} ${formatHora12(c.cerrada_at)}`,
  fechaISO(m.created_at),
  formatHora12(m.created_at),
  m.tipo === 'salida' ? 'Salida' : 'Entrada',
  m.concepto ?? '',
  m.usuario ?? '',
  num(m.tipo === 'salida' ? -m.monto : m.monto),
]);

const filaCSV = (c) => [
  fechaISO(c.cerrada_at),
  formatHora12(c.cerrada_at),
  c.usuario_apertura ?? '',
  c.usuario_cierre ?? '',
  num(c.monto_inicial),
  num(c.ventas),
  num(c.ventas_desglose?.efectivo ?? c.ventas),
  num(c.ventas_desglose?.transferencia ?? 0),
  num(c.ventas_desglose?.tarjeta ?? 0),
  num(c.entradas),
  num(c.salidas),
  num(c.esperado),
  c.contado != null ? num(c.contado) : '',
  c.diferencia != null ? num(c.diferencia) : '',
  estadoCorte(c),
  c.notas_apertura ?? '',
  c.notas_cierre ?? '',
];

// Descarga uno o varios cortes como CSV. `sufijo` va en el nombre del archivo.
export function descargarCortesCSV(cortes, sufijo) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  const movs = lista.flatMap(filasMovimientos);
  const filas = lista.map(filaCSV);
  // Debajo de los cortes, separada por una fila vacía, la tabla de movimientos.
  if (movs.length > 0) filas.push([], ['Entradas y salidas'], ENCABEZADOS_MOVS, ...movs);
  descargarCSV(`cortes-${slug(sufijo)}`, ENCABEZADOS_CSV, filas);
}

// ── PDF (impresión del navegador) ───────────────────────────
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

// Tabla de entradas y salidas de un corte, o '' si no hubo ninguna.
const tablaMovimientos = (c) => {
  const movs = c.movimientos ?? [];
  if (movs.length === 0) return '';
  return `
    <p class="seccion">Entradas y salidas</p>
    <table class="resumen">
      <thead>
        <tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Registró</th><th class="r">Monto</th></tr>
      </thead>
      <tbody>${movs.map((m) => `
        <tr>
          <td>${esc(formatHora12(m.created_at))}</td>
          <td>${m.tipo === 'salida' ? 'Salida' : 'Entrada'}</td>
          <td>${esc(m.concepto)}</td>
          <td>${esc(m.usuario || '—')}</td>
          <td class="r ${m.tipo === 'salida' ? 'neg' : 'pos'}">${m.tipo === 'salida' ? '−' : '+'}${fmtMoneda(m.monto)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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
        <tr><td>Ventas en efectivo</td><td class="r">${fmtMoneda(c.ventas_desglose?.efectivo ?? c.ventas)}</td></tr>
        ${(c.ventas_desglose?.transferencia ?? 0) > 0
          ? `<tr><td>Cobrado por transferencia (fuera del cajón)</td><td class="r">${fmtMoneda(c.ventas_desglose.transferencia)}</td></tr>`
          : ''}
        ${(c.ventas_desglose?.tarjeta ?? 0) > 0
          ? `<tr><td>Cobrado con tarjeta (fuera del cajón)</td><td class="r">${fmtMoneda(c.ventas_desglose.tarjeta)}</td></tr>`
          : ''}
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
    ${tablaMovimientos(c)}
  </section>`;

// Con varios cortes, después de la tabla resumen: las notas y las entradas y
// salidas de cada corte que tenga alguna, para que ninguna quede fuera.
const detalleNotas = (cortes) => {
  const conAlgo = cortes.filter((c) =>
    c.notas_apertura || c.notas_cierre || (c.movimientos ?? []).length > 0);
  if (conAlgo.length === 0) return '';
  return `
    <p class="seccion">Notas, entradas y salidas</p>
    ${conAlgo.map((c) => `
      <section class="corte">
        <div class="corte-head">
          <h2>${esc(fechaLarga(c.cerrada_at))}</h2>
          <span class="hora">${esc(formatHora12(c.abierta_at))} – ${esc(formatHora12(c.cerrada_at))}</span>
        </div>
        ${c.notas_apertura || c.notas_cierre ? `
          <div class="firmas">
            ${c.notas_apertura ? `<div><span class="lbl">Nota al abrir · ${esc(c.usuario_apertura || '—')}</span>
              <p class="nota">${esc(c.notas_apertura)}</p></div>` : ''}
            ${c.notas_cierre ? `<div><span class="lbl">Nota al cerrar · ${esc(c.usuario_cierre || '—')}</span>
              <p class="nota">${esc(c.notas_cierre)}</p></div>` : ''}
          </div>` : ''}
        ${tablaMovimientos(c)}
      </section>`).join('')}`;
};

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

// Abre una ventana con el/los corte(s) y lanza la impresión (Guardar como PDF).
export function imprimirCortes(cortes, { titulo, subtitulo } = {}) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  if (lista.length === 0) return;
  const cuerpo = lista.length === 1 ? bloqueDetalle(lista[0]) : tablaResumen(lista) + detalleNotas(lista);
  imprimirDocumento({ titulo: titulo || 'Corte de caja', subtitulo, cuerpo });
}
