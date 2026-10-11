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
//
// Desde el 2026-10-10 cada turno lleva también sus Ingresos (por máquina,
// productos, SPE y edredón), Egresos (SPE Debe y gastos) y el Desglose, con las
// mismas líneas que la pantalla (lib/desgloseCaja.js). Ventas reutiliza estas
// piezas para sus propias exportaciones.

import { formatHora12 } from './fecha';
import { desgloseCaja } from './desgloseCaja';
import {
  fmtMoneda, num, fechaLarga, fechaISO, slug, esc,
  descargarCSV, imprimirDocumento,
} from './exportUtils';

// El turno que sigue abierto también se exporta (2026-10-04, para el filtro
// Hoy): no tiene cierre, así que su fecha es la de apertura y donde iría la
// hora de cierre dice "en curso".
const fechaCorte = (c) => c.cerrada_at ?? c.abierta_at;
const horaCierre = (c) => (c.en_curso ? 'en curso' : formatHora12(c.cerrada_at));
const quienCerro = (c) => (c.en_curso ? 'En curso' : (c.usuario_cierre || '—'));

// Estado del corte según su diferencia.
const estadoCorte = (c) => {
  if (c.en_curso) return 'En curso';
  if (c.contado == null || c.diferencia == null) return '';
  if (Math.abs(c.diferencia) < 0.005) return 'Cuadra';
  return c.diferencia < 0 ? 'Faltante' : 'Sobrante';
};

// ── CSV ─────────────────────────────────────────────────────
const ENCABEZADOS_CSV = [
  'Fecha', 'Hora', 'Abrió', 'Cerró', 'Caja inicial', 'Ventas', 'Ventas efectivo', 'Transferencia', 'Tarjeta',
  'Lavadoras Medianas', 'Lavadoras Jumbo', 'Secadoras', 'SPE', 'Edredón', 'Productos',
  'Entradas', 'Salidas', 'Total ingresos', 'SPE Debe', 'Total egresos',
  'Esperado', 'Contado', 'Diferencia', 'Caja final', 'Sobre',
  'Estado', 'Nota apertura', 'Nota cierre',
];

// Segunda tabla del CSV: una fila por entrada o salida, con el corte al que
// pertenece. La salida va en negativo para que en Excel se pueda sumar.
const ENCABEZADOS_MOVS = ['Corte', 'Fecha', 'Hora', 'Tipo', 'Concepto', 'Registró', 'Monto'];

const filasMovimientos = (c) => (c.movimientos ?? []).map((m) => [
  `${fechaISO(fechaCorte(c))} ${horaCierre(c)}`,
  fechaISO(m.created_at),
  formatHora12(m.created_at),
  m.tipo === 'salida' ? 'Salida' : 'Entrada',
  m.concepto ?? '',
  m.usuario ?? '',
  num(m.tipo === 'salida' ? -m.monto : m.monto),
]);

// Un importe del reparto del efectivo, vacío si el corte no lo trae.
const ing = (c, k) => (c.ingresos ? num(c.ingresos[k] ?? 0) : '');

const filaCSV = (c) => [
  fechaISO(fechaCorte(c)),
  horaCierre(c),
  c.usuario_apertura ?? '',
  c.en_curso ? 'En curso' : (c.usuario_cierre ?? ''),
  num(c.monto_inicial),
  num(c.ventas),
  num(c.ventas_desglose?.efectivo ?? c.ventas),
  num(c.ventas_desglose?.transferencia ?? 0),
  num(c.ventas_desglose?.tarjeta ?? 0),
  ing(c, 'lavadoras_medianas'),
  ing(c, 'lavadoras_jumbo'),
  ing(c, 'secadoras'),
  ing(c, 'por_encargo'),
  ing(c, 'edredon'),
  ing(c, 'productos'),
  num(c.entradas),
  num(c.salidas),
  num(desgloseCaja(c).totalIngresos),
  // Sin dato en los cortes anteriores a la mig. 153.
  c.spe_debe != null ? num(c.spe_debe) : '',
  num(desgloseCaja(c).totalEgresos),
  num(c.esperado),
  c.contado != null ? num(c.contado) : '',
  c.diferencia != null ? num(c.diferencia) : '',
  // Reparto de lo contado (mig. 151); vacío en cortes de antes.
  c.caja_final != null ? num(c.caja_final) : '',
  c.sobre != null ? num(c.sobre) : '',
  estadoCorte(c),
  c.notas_apertura ?? '',
  c.notas_cierre ?? '',
];

// La tabla de cortes del CSV: encabezados y una fila por corte, más la tabla
// de entradas y salidas debajo. Ventas la reutiliza para sus turnos.
export function tablaCortesCSV(cortes) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  const movs = lista.flatMap(filasMovimientos);
  // Tarjeta ya no se ofrece al cobrar (2026-10-06): su columna solo sale si
  // algún corte exportado trae cobros viejos con tarjeta.
  const conTarjeta = lista.some((c) => (c.ventas_desglose?.tarjeta ?? 0) > 0);
  const iTarjeta = ENCABEZADOS_CSV.indexOf('Tarjeta');
  const sinTarjeta = (fila) => fila.filter((_, i) => i !== iTarjeta);
  const encabezados = conTarjeta ? ENCABEZADOS_CSV : sinTarjeta(ENCABEZADOS_CSV);
  const filas = lista.map((c) => (conTarjeta ? filaCSV(c) : sinTarjeta(filaCSV(c))));
  // Debajo de los cortes, separada por una fila vacía, la tabla de movimientos.
  if (movs.length > 0) filas.push([], ['Entradas y salidas'], ENCABEZADOS_MOVS, ...movs);
  return { encabezados, filas };
}

// Descarga uno o varios cortes como CSV. `sufijo` va en el nombre del archivo.
export function descargarCortesCSV(cortes, sufijo) {
  const { encabezados, filas } = tablaCortesCSV(cortes);
  descargarCSV(`cortes-${slug(sufijo)}`, encabezados, filas);
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

// Una tabla de Ingresos, Egresos o Desglose con su renglón de total.
const tablaLineas = (titulo, lineas, totalLabel, total) => `
    <p class="seccion">${esc(titulo)}</p>
    <table class="desglose">
      <tbody>
        ${lineas.map((l) => `
        <tr><td>${esc(l.label)}${l.nota ? ` <span class="nota">(${esc(l.nota)})</span>` : ''}</td>
          <td class="r">${l.sign}${fmtMoneda(l.value)}</td></tr>`).join('')}
        <tr class="tot"><td>${esc(totalLabel)}</td><td class="r">${fmtMoneda(total)}</td></tr>
      </tbody>
    </table>`;

// Bloque detallado de un corte (encabezado + Ingresos, Egresos y Desglose +
// conteo + firmas + entradas y salidas). Ventas lo reutiliza por turno.
export const bloqueDetalle = (c) => {
  const d = desgloseCaja(c);
  return `
  <section class="corte">
    <div class="corte-head">
      <h2>${esc(fechaLarga(fechaCorte(c)))}${c.en_curso ? ' · turno en curso' : ''}</h2>
      <span class="hora">${esc(formatHora12(c.abierta_at))} – ${esc(horaCierre(c))}</span>
    </div>
    ${tablaLineas('Ingresos', d.ingresos, 'Total ingresos', d.totalIngresos)}
    ${(c.ventas_desglose?.tarjeta ?? 0) > 0
      ? `<p class="nota">Además, cobrado con tarjeta (fuera del cajón): ${fmtMoneda(c.ventas_desglose.tarjeta)}</p>`
      : ''}
    ${tablaLineas('Egresos', d.egresos, 'Total egresos', d.totalEgresos)}
    ${tablaLineas('Desglose esperado', d.desglose, c.en_curso ? 'Esperado hasta ahora' : 'Esperado en caja', c.esperado)}
    <table class="desglose">
      <tbody>
        <tr><td>Efectivo contado</td><td class="r">${c.contado != null ? fmtMoneda(c.contado) : '—'}</td></tr>
        <tr class="dif ${claseDif(c)}"><td>Diferencia</td><td class="r">${textoDif(c)}</td></tr>
        ${c.caja_final != null ? `
        <tr><td>Caja final (queda en el cajón)</td><td class="r">${fmtMoneda(c.caja_final)}</td></tr>
        <tr><td>Sobre</td><td class="r">${fmtMoneda(c.sobre)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="firmas">
      <div><span class="lbl">Abrió</span> ${esc(c.usuario_apertura || '—')}
        ${c.notas_apertura ? `<p class="nota">${esc(c.notas_apertura)}</p>` : ''}</div>
      <div><span class="lbl">Cerró</span> ${esc(quienCerro(c))}
        ${c.notas_cierre ? `<p class="nota">${esc(c.notas_cierre)}</p>` : ''}</div>
    </div>
    ${tablaMovimientos(c)}
  </section>`;
};

// Con varios cortes, después de la tabla resumen: el detalle completo de cada
// uno (Ingresos, Egresos, Desglose, notas, entradas y salidas), para que
// ninguno quede fuera.
const detallePorCorte = (cortes) => `
    <p class="seccion">Detalle por turno</p>
    ${cortes.map(bloqueDetalle).join('')}`;

// Tabla resumen (una fila por corte) + totales, para varios cortes.
const tablaResumen = (cortes) => {
  const suma = (k) => cortes.reduce((a, c) => a + Number(c[k] ?? 0), 0);
  const filas = cortes.map((c) => `
    <tr>
      <td>${esc(fechaLarga(fechaCorte(c)))}${c.en_curso ? ' (en curso)' : ''}</td>
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
          <th>Fecha</th><th class="r">Caja inicial</th><th class="r">Ventas</th>
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
  const cuerpo = lista.length === 1 ? bloqueDetalle(lista[0]) : tablaResumen(lista) + detallePorCorte(lista);
  imprimirDocumento({ titulo: titulo || 'Corte de caja', subtitulo, cuerpo });
}
