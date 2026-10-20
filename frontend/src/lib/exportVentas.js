/**
 * Reporte de Ventas a Excel y PDF (exportExcel.js y exportUtils.js). Recibe GET /ventas/resumen:
 *   { tarjetas: { total_cobrado, notas_pagadas, productos_consumidos, notas_pendientes },
 *     corte:    { total_servicios, total_cargas, total_productos, total_ajustes,
 *                 total_efectivo, total_transferencia, total_tarjeta,
 *                 total_general (suma de conceptos), total_cobrado },
 *     lista_notas: [{ folio, fecha, creado_en, estado, maquinas:[{nombre,cargas}],
 *                     atendio, forma_pago, total_productos, total }],
 *     turnos: [turnos de caja del período, con la forma de /caja/historial] }
 *
 * Los turnos salen como en el PDF del corte (bloqueDetalle de exportCorte.js).
 */

import { formatHora12 } from './fecha';
import { formaPagoLabel } from './formasPago';
import { fmtMoneda, fechaLarga, slug, esc, imprimirDocumento } from './exportUtils';
import { descargarExcel } from './exportExcel';
import { etiquetaEstadoNota } from './estadoNota';
import { hojasCortes, bloqueDetalle } from './exportCorte';
import { lineasConcepto } from './desgloseCaja';

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
// LISTA según el servicio (en Autoservicio espera su cobro).
const estadoLabel = (e, tipoServicio) =>
  etiquetaEstadoNota(e, tipoServicio, ESTADO_LABEL[e] ?? (e ?? ''));


// El servicio de la nota, con las mismas palabras que la tabla de Ventas.
const SERVICIO_LABEL = {
  AUTOSERVICIO: 'Autoservicio',
  POR_ENCARGO:  'Por Encargo',
  EDREDON:      'Edredón',
  PRODUCTOS:    'Productos',
};
const servicioLabel = (t) => SERVICIO_LABEL[t] ?? (t ?? '');

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

// ── Excel ───────────────────────────────────────────────────
// "Pago" separa las pendientes y canceladas, que no cuentan en lo cobrado.
const pagoLabel = (n) => {
  if (n.estado === 'CANCELADA') return 'Cancelada';
  return n.estado_pago === 'PENDIENTE' ? 'Pendiente' : 'Pagada';
};
const cuenta = (n) => pagoLabel(n) === 'Pagada';

const hojaNotas = (notas) => {
  const filas = notas.map((n) => [
    n.folio ?? '',
    typeof n.fecha === 'string' ? n.fecha.slice(0, 10) : '',
    formatHora12(n.creado_en),
    servicioLabel(n.tipo_servicio),
    estadoLabel(n.estado, n.tipo_servicio),
    pagoLabel(n),
    maquinasTexto(n.maquinas),
    n.atendio ?? '',
    formaPagoLabel(n.forma_pago),
    n.total_productos,
    n.total,
  ]);
  const pagadas = notas.filter(cuenta);
  const suma = (k) => pagadas.reduce((a, n) => a + Number(n[k] ?? 0), 0);
  return {
    nombre: 'Notas',
    grupos: [
      { titulo: 'Nota', color: 'gris', columnas: [
        { titulo: 'Folio', ancho: 14 },
        { titulo: 'Fecha', tipo: 'fecha', ancho: 24 },
        { titulo: 'Hora', ancho: 15 },
        { titulo: 'Servicio', ancho: 19 },
      ] },
      { titulo: 'Estado', color: 'azul', columnas: [
        { titulo: 'Estado', ancho: 19 },
        { titulo: 'Pago', ancho: 15 },
      ] },
      { titulo: 'Quién y con qué', color: 'verde', columnas: [
        { titulo: 'Máquinas', tipo: 'notas', ancho: 36 },
        { titulo: 'Atendió', ancho: 25 },
      ] },
      { titulo: 'Cobro', color: 'ambar', columnas: [
        { titulo: 'Forma de pago', ancho: 20 },
        { titulo: 'Productos', tipo: 'moneda', ancho: 17 },
        { titulo: 'Total', tipo: 'moneda', ancho: 17, negritas: true },
      ] },
    ],
    filas,
    // Las pendientes y canceladas, en gris (no cuentan en los totales).
    atenuadas: new Set(notas.map((n, i) => (cuenta(n) ? -1 : i)).filter((i) => i >= 0)),
    pie: notas.length > 0
      ? [[`Totales (${pagadas.length} pagadas)`, null, null, null, null, null, null, null, null,
          suma('total_productos'), suma('total')]]
      : [],
    nota: notas.some((n) => !cuenta(n))
      ? 'Las notas pendientes y canceladas van en gris y no cuentan en los totales.'
      : undefined,
  };
};

const hojaAbonos = (abonos) => abonos.length > 0 && {
  nombre: 'Abonos',
  grupos: [
    { titulo: 'Nota', color: 'gris', columnas: [
      { titulo: 'Folio', ancho: 14 },
      { titulo: 'Fecha', tipo: 'fecha', ancho: 24 },
      { titulo: 'Hora', ancho: 15 },
    ] },
    { titulo: 'Pago', color: 'ambar', columnas: [
      { titulo: 'Forma de pago', ancho: 20 },
      { titulo: 'Recibió', ancho: 25 },
      { titulo: 'Monto', tipo: 'moneda', ancho: 17, negritas: true },
    ] },
  ],
  filas: abonos.map((a) => [
    a.folio ?? '',
    typeof a.fecha === 'string' ? a.fecha.slice(0, 10) : '',
    formatHora12(a.creado_en),
    formaPagoLabel(a.forma_pago),
    a.recibio ?? '',
    a.monto,
  ]),
  pie: [[`Total abonado (${abonos.length})`, null, null, null, null,
    abonos.reduce((t, a) => t + Number(a.monto || 0), 0)]],
};

/** Hojas del Excel de ventas: Notas, Abonos y los turnos de caja del período. */
export function hojasVentas(data) {
  const turnos = data?.turnos ?? [];
  return [
    hojaNotas(data?.lista_notas ?? []),
    hojaAbonos(data?.abonos ?? []),
    ...(turnos.length > 0 ? hojasCortes(turnos, { nombre: 'Turnos de caja' }) : []),
  ].filter(Boolean);
}

// Descarga el reporte del período como Excel. `sufijo` va en el nombre.
export async function descargarVentasExcel(data, sufijo) {
  await descargarExcel(`ventas-${slug(sufijo)}`, hojasVentas(data));
}

// ── PDF (impresión del navegador) ───────────────────────────
// Franja de arriba con las cifras del período (como la del corte).
const casilla = (k, v, s) =>
  `<div><p class="k">${esc(k)}</p><p class="v">${esc(v)}</p>${s ? `<p class="s">${esc(s)}</p>` : ''}</div>`;

const bloqueCifras = (tj) => `
  <div class="cifras">
    ${casilla('Total cobrado', fmtMoneda(tj?.total_cobrado))}
    ${casilla('Notas pagadas', tj?.notas_pagadas ?? 0)}
    ${casilla('Productos consumidos', tj?.productos_consumidos ?? 0, 'unidades')}
    ${casilla('Notas con saldo', tj?.notas_pendientes ?? 0, 'por cobrar')}
  </div>`;

const filaCorte = (etiqueta, valor, total = false) => `
  <tr${total ? ' class="tot"' : ''}>
    <td>${esc(etiqueta)}</td><td class="r">${fmtMoneda(valor)}</td>
  </tr>`;

// Lo cobrado repartido por concepto (como el corte de Caja) y, al lado, cómo
// se cobró. Los conceptos suman el total cobrado.
const bloqueCorte = (c) => `
  <div class="dos">
    <div>
      <p class="seccion">Por concepto</p>
      <table class="desglose">
        <tbody>
          ${lineasConcepto(c?.conceptos).map((l) => filaCorte(l.label, l.value)).join('')}
          ${filaCorte('Total cobrado', c?.total_cobrado, true)}
        </tbody>
      </table>
    </div>
    <div>
      <p class="seccion">Cómo se cobró</p>
      <table class="desglose">
        <tbody>
          ${filaCorte('Efectivo', c?.total_efectivo)}
          ${filaCorte('Transferencia', c?.total_transferencia)}
          ${(c?.total_tarjeta ?? 0) > 0 ? filaCorte('Tarjeta', c.total_tarjeta) : ''}
        </tbody>
      </table>
    </div>
  </div>`;

const bloqueNotas = (notas) => {
  if (notas.length === 0) return '<div class="seccion">Notas</div><p>Sin notas en este período.</p>';
  // Las pendientes y canceladas se marcan y no cuentan en los totales.
  const hayExcluidas = notas.some((n) => n.estado === 'CANCELADA' || n.estado_pago === 'PENDIENTE');
  const filas = notas.map((n) => {
    const cancelada = n.estado === 'CANCELADA';
    const pendiente = !cancelada && n.estado_pago === 'PENDIENTE';
    const cls = cancelada ? 'cancelada' : pendiente ? 'pendiente' : '';
    const estadoCell = `${esc(estadoLabel(n.estado, n.tipo_servicio))}` +
      (pendiente ? ' <span class="chip">Pago pendiente</span>' : '');
    const totalCell = cancelada || pendiente
      ? `<span class="tachado">${fmtMoneda(n.total)}</span>`
      : fmtMoneda(n.total);
    return `
    <tr class="${cls}">
      <td>${esc(n.folio)}</td>
      <td>${esc(fechaLarga(fechaNotaLocal(n.fecha)))}</td>
      <td>${esc(servicioLabel(n.tipo_servicio) || '—')}</td>
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
          <th>Folio</th><th>Fecha</th><th>Servicio</th><th>Estado</th><th>Máquinas</th>
          <th>Atendió</th><th>Pago</th><th class="r">Productos</th><th class="r">Total</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
};

// Abonos del período y quién recibió cada uno; solo si hay.
const bloqueAbonos = (abonos) => {
  if (abonos.length === 0) return '';
  const total = abonos.reduce((t, a) => t + Number(a.monto || 0), 0);
  const filas = abonos.map((a) => `
    <tr>
      <td>${esc(a.folio)}</td>
      <td>${esc(fechaLarga(fechaNotaLocal(a.fecha)))}</td>
      <td>${esc(formatHora12(a.creado_en))}</td>
      <td>${esc(formaPagoLabel(a.forma_pago) || '—')}</td>
      <td>${esc(a.recibio || '—')}</td>
      <td class="r">${fmtMoneda(a.monto)}</td>
    </tr>`).join('');
  return `
    <div class="seccion">Abonos recibidos (${abonos.length})</div>
    <table class="resumen">
      <thead>
        <tr>
          <th>Folio</th><th>Fecha</th><th>Hora</th><th>Pago</th>
          <th>Recibió</th><th class="r">Monto</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr class="tot"><td colspan="5">Total abonado</td><td class="r">${fmtMoneda(total)}</td></tr>
      </tfoot>
    </table>`;
};

// Un bloque por turno de caja del período, con sus cifras, Ingresos y Egresos.
const bloqueTurnos = (turnos) => (turnos.length === 0 ? '' : `
  <p class="seccion">Turnos de caja (${turnos.length})</p>
  ${turnos.map(bloqueDetalle).join('')}`);

// Abre una ventana con el reporte de ventas y lanza la impresión (Guardar PDF).
export function imprimirVentas(data, { titulo, subtitulo } = {}) {
  if (!data) return;
  const cuerpo =
    bloqueCifras(data.tarjetas) +
    bloqueCorte(data.corte) +
    bloqueTurnos(data.turnos ?? []) +
    bloqueAbonos(data.abonos ?? []) +
    bloqueNotas(data.lista_notas ?? []);
  imprimirDocumento({ titulo: titulo || 'Ventas', subtitulo, cuerpo });
}
