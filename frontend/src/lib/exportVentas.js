// Exportación del reporte de Ventas a CSV (Excel) y a PDF. Ver exportUtils.js
// para las piezas compartidas.
//
// Recibe el objeto que devuelve GET /ventas/resumen:
//   { tarjetas: { total_cobrado, notas_pagadas, productos_consumidos, notas_pendientes },
//     corte:    { total_cargas, total_productos, total_ajustes,
//                 total_efectivo, total_transferencia, total_tarjeta, total_general },
//     lista_notas: [{ folio, fecha, creado_en, estado, maquinas:[{nombre,cargas}],
//                     atendio, forma_pago, total_productos, total }] }

import { formatHora12 } from './fecha';
import { formaPagoLabel } from './formasPago';
import {
  fmtMoneda, num, fechaLarga, slug, esc,
  descargarCSV, imprimirDocumento,
} from './exportUtils';

// Etiquetas de estado (iguales a las de la tabla de Ventas).
const ESTADO_LABEL = {
  EN_ESPERA:  'En Espera',
  LAVANDO:    'Lavando',
  SECANDO:    'Secando',
  LISTA:      'Por Entregar',
  PAGADA:     'Pagada',
  FINALIZADA: 'Finalizada',
  CANCELADA:  'Cancelada',
};
const estadoLabel = (e) => ESTADO_LABEL[e] ?? (e ?? '');


// Máquinas de una nota como texto: "Lavadora 1 (2 cargas), Secadora 3 (1 carga)".
const maquinasTexto = (maquinas) =>
  (maquinas ?? [])
    .map((m) => `${m.nombre} (${m.cargas} ${m.cargas === 1 ? 'carga' : 'cargas'})`)
    .join(', ');

// "YYYY-MM-DD" → Date local (sin corrimiento por zona horaria).
const fechaNotaLocal = (fecha) => {
  const s = typeof fecha === 'string' ? fecha.slice(0, 10) : null;
  if (s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(fecha);
};

// ── CSV ─────────────────────────────────────────────────────
const ENCABEZADOS_CSV = [
  'Folio', 'Fecha', 'Hora', 'Estado', 'Máquinas', 'Atendió',
  'Forma de pago', 'Productos', 'Total',
];

const filaCSV = (n) => [
  n.folio ?? '',
  typeof n.fecha === 'string' ? n.fecha.slice(0, 10) : '',
  formatHora12(n.creado_en),
  estadoLabel(n.estado),
  maquinasTexto(n.maquinas),
  n.atendio ?? '',
  formaPagoLabel(n.forma_pago),
  num(n.total_productos),
  num(n.total),
];

// Descarga la lista de notas del período como CSV. `sufijo` va en el nombre.
export function descargarVentasCSV(data, sufijo) {
  const notas = data?.lista_notas ?? [];
  descargarCSV(`ventas-${slug(sufijo)}`, ENCABEZADOS_CSV, notas.map(filaCSV));
}

// ── PDF (impresión del navegador) ───────────────────────────
const tarjeta = (t, v, sub) =>
  `<div class="tarjeta"><div class="t">${esc(t)}</div><div class="v">${esc(v)}</div>` +
  `${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

const bloqueTarjetas = (tj) => `
  <div class="tarjetas">
    ${tarjeta('Total cobrado', fmtMoneda(tj?.total_cobrado))}
    ${tarjeta('Notas pagadas', tj?.notas_pagadas ?? 0)}
    ${tarjeta('Productos consumidos', tj?.productos_consumidos ?? 0, 'unidades')}
    ${tarjeta('Saldo pendiente', tj?.notas_pendientes ?? 0, 'notas con saldo')}
  </div>`;

const filaCorte = (etiqueta, valor, total = false) => `
  <tr${total ? ' class="tot"' : ''}>
    <td>${esc(etiqueta)}</td><td class="r">${fmtMoneda(valor)}</td>
  </tr>`;

const bloqueCorte = (c) => `
  <div class="seccion">Corte de caja</div>
  <table class="desglose">
    <tbody>
      ${filaCorte('Total por cargas de lavado', c?.total_cargas)}
      ${filaCorte('Total por artículos vendidos', c?.total_productos)}
      ${filaCorte('Total ajustes', c?.total_ajustes)}
      ${filaCorte('Total en efectivo', c?.total_efectivo)}
      ${filaCorte('Total en transferencia', c?.total_transferencia)}
      ${filaCorte('Total con tarjeta', c?.total_tarjeta)}
      ${filaCorte('Total general', c?.total_general, true)}
    </tbody>
  </table>`;

const bloqueNotas = (notas) => {
  if (notas.length === 0) return '<div class="seccion">Notas</div><p>Sin notas en este período.</p>';
  // Las pendientes y canceladas se marcan y no cuentan en los totales.
  const hayExcluidas = notas.some((n) => n.estado === 'CANCELADA' || n.estado_pago === 'PENDIENTE');
  const filas = notas.map((n) => {
    const cancelada = n.estado === 'CANCELADA';
    const pendiente = !cancelada && n.estado_pago === 'PENDIENTE';
    const cls = cancelada ? 'cancelada' : pendiente ? 'pendiente' : '';
    const estadoCell = `${esc(estadoLabel(n.estado))}` +
      (pendiente ? ' <span class="chip">Pago pendiente</span>' : '');
    const totalCell = cancelada || pendiente
      ? `<span class="tachado">${fmtMoneda(n.total)}</span>`
      : fmtMoneda(n.total);
    return `
    <tr class="${cls}">
      <td>${esc(n.folio)}</td>
      <td>${esc(fechaLarga(fechaNotaLocal(n.fecha)))}</td>
      <td>${estadoCell}</td>
      <td>${esc(maquinasTexto(n.maquinas) || '—')}</td>
      <td>${esc(n.atendio || '—')}</td>
      <td>${esc(formaPagoLabel(n.forma_pago) || '—')}</td>
      <td class="r">${fmtMoneda(n.total_productos)}</td>
      <td class="r">${totalCell}</td>
    </tr>`;
  }).join('');
  return `
    <div class="seccion">Notas (${notas.length})</div>
    ${hayExcluidas ? '<p class="aviso">Las notas pendientes y canceladas se muestran atenuadas y no cuentan en los totales.</p>' : ''}
    <table class="resumen">
      <thead>
        <tr>
          <th>Folio</th><th>Fecha</th><th>Estado</th><th>Máquinas</th>
          <th>Atendió</th><th>Pago</th><th class="r">Productos</th><th class="r">Total</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
};

// Abre una ventana con el reporte de ventas y lanza la impresión (Guardar PDF).
export function imprimirVentas(data, { titulo, subtitulo } = {}) {
  if (!data) return;
  const cuerpo =
    bloqueTarjetas(data.tarjetas) +
    bloqueCorte(data.corte) +
    bloqueNotas(data.lista_notas ?? []);
  imprimirDocumento({ titulo: titulo || 'Ventas', subtitulo, cuerpo });
}
