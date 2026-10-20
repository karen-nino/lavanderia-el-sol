/**
 * Cortes de caja a CSV y PDF (piezas compartidas en exportUtils.js). Cada
 * `corte` tiene la forma de GET /caja/historial:
 *   { usuario_apertura, usuario_cierre, abierta_at, cerrada_at,
 *     notas_apertura, notas_cierre, monto_inicial, ventas, entradas,
 *     salidas, esperado, contado, diferencia,
 *     movimientos: [{ tipo, concepto, monto, usuario, created_at }] }
 *
 * Cada turno lleva Ingresos, Egresos y Desglose (lib/desgloseCaja.js) y sus
 * entradas y salidas. Ventas reusa estas piezas.
 */

import { formatHora12 } from './fecha';
import { desgloseCaja } from './desgloseCaja';
import {
  fmtMoneda, num, fechaLarga, fechaISO, slug, esc,
  descargarCSV, imprimirDocumento,
} from './exportUtils';

// El turno abierto también se exporta: su fecha es la de apertura y el cierre
// dice "en curso".
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
  'Entradas', 'Gastos', 'Total ingresos', 'SPE Debe', 'Total egresos',
  'Esperado', 'Contado', 'Diferencia', 'Caja final', 'Sobre',
  'Estado', 'Nota apertura', 'Nota cierre',
];

// Segunda tabla del CSV: una fila por movimiento con su corte; la salida en
// negativo para sumar en Excel.
const ENCABEZADOS_MOVS = ['Corte', 'Fecha', 'Hora', 'Tipo', 'Concepto', 'Registró', 'Monto'];

const filasMovimientos = (c) => (c.movimientos ?? []).map((m) => [
  `${fechaISO(fechaCorte(c))} ${horaCierre(c)}`,
  fechaISO(m.created_at),
  formatHora12(m.created_at),
  m.tipo === 'salida' ? 'Gasto' : 'Entrada',
  m.concepto ?? '',
  m.usuario ?? '',
  num(m.tipo === 'salida' ? -m.monto : m.monto),
]);

// Un importe del reparto por concepto, vacío si el corte no lo trae.
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
  // Sin dato en cortes viejos.
  c.spe_debe != null ? num(c.spe_debe) : '',
  num(desgloseCaja(c).totalEgresos),
  num(c.esperado),
  c.contado != null ? num(c.contado) : '',
  c.diferencia != null ? num(c.diferencia) : '',
  // Reparto de lo contado; vacío en cortes que no lo tienen.
  c.caja_final != null ? num(c.caja_final) : '',
  c.sobre != null ? num(c.sobre) : '',
  estadoCorte(c),
  c.notas_apertura ?? '',
  c.notas_cierre ?? '',
];

/** Tabla de cortes del CSV (una fila por corte) y debajo la de movimientos. Ventas la reusa. */
export function tablaCortesCSV(cortes) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  const movs = lista.flatMap(filasMovimientos);
  // La columna de tarjeta solo si algún corte trae cobros con tarjeta.
  const conTarjeta = lista.some((c) => (c.ventas_desglose?.tarjeta ?? 0) > 0);
  const iTarjeta = ENCABEZADOS_CSV.indexOf('Tarjeta');
  const sinTarjeta = (fila) => fila.filter((_, i) => i !== iTarjeta);
  const encabezados = conTarjeta ? ENCABEZADOS_CSV : sinTarjeta(ENCABEZADOS_CSV);
  const filas = lista.map((c) => (conTarjeta ? filaCSV(c) : sinTarjeta(filaCSV(c))));
  // Debajo de los cortes, separada por una fila vacía, la tabla de movimientos.
  if (movs.length > 0) filas.push([], ['Entradas y gastos'], ENCABEZADOS_MOVS, ...movs);
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

// Casilla de la diferencia en el resumen: { valor, nota, clase }.
const casillaDif = (c) => {
  if (c.contado == null || c.diferencia == null) return { valor: '—', nota: '', clase: '' };
  if (Math.abs(c.diferencia) < 0.005) return { valor: 'Cuadra', nota: '', clase: 'cuadra' };
  return c.diferencia < 0
    ? { valor: `−${fmtMoneda(-c.diferencia)}`, nota: 'Faltante', clase: 'falta' }
    : { valor: `+${fmtMoneda(c.diferencia)}`, nota: 'Sobrante', clase: 'sobra' };
};

// Franja de arriba: esperado, contado, diferencia y el sobre con la caja final.
const resumenCorte = (c) => {
  const dif = casillaDif(c);
  return `
    <div class="cifras">
      <div><p class="k">${c.en_curso ? 'Esperado hasta ahora' : 'Esperado en caja'}</p>
        <p class="v">${fmtMoneda(c.esperado)}</p></div>
      <div><p class="k">Efectivo contado</p>
        <p class="v">${c.contado != null ? fmtMoneda(c.contado) : '—'}</p></div>
      <div class="${dif.clase}"><p class="k">Diferencia</p>
        <p class="v">${dif.valor}</p>${dif.nota ? `<p class="s">${dif.nota}</p>` : ''}</div>
      <div><p class="k">Sobre</p>
        <p class="v">${c.sobre != null ? fmtMoneda(c.sobre) : '—'}</p>
        ${c.caja_final != null ? `<p class="s">Caja final ${fmtMoneda(c.caja_final)}</p>` : ''}</div>
    </div>`;
};

// Tabla de entradas y gastos de un corte, o '' si no hubo ninguno. Quién lo
// registró va bajo el concepto; el signo y el color dicen si entró o salió.
const tablaMovimientos = (c) => {
  const movs = c.movimientos ?? [];
  if (movs.length === 0) return '';
  return `
    <p class="seccion">Entradas y gastos</p>
    <table class="movs">
      <thead>
        <tr><th>Hora</th><th>Concepto</th><th class="r">Monto</th></tr>
      </thead>
      <tbody>${movs.map((m) => `
        <tr>
          <td class="hora">${esc(formatHora12(m.created_at))}</td>
          <td>${esc(m.concepto)}<span class="quien">${m.tipo === 'salida' ? 'Gasto' : 'Entrada'} · ${esc(m.usuario || '—')}</span></td>
          <td class="r ${m.tipo === 'salida' ? 'neg' : 'pos'}">${m.tipo === 'salida' ? '−' : '+'}${fmtMoneda(m.monto)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
};

// Tabla de Ingresos o Egresos con su total. `aparte` ({ titulo, lineas }):
// renglones informativos que no suman (Cómo se cobró).
const filaLinea = (l) => l.titulo ? `
        <tr class="sub"><td colspan="2">${esc(l.label)}</td></tr>` : l.subtotal ? `
        <tr class="subtot"><td>${esc(l.label)}</td><td class="r">${fmtMoneda(l.value)}</td></tr>` : `
        <tr><td>${esc(l.label)}${l.nota ? `<span class="nota">${esc(l.nota)}</span>` : ''}</td>
          <td class="r">${l.sign}${fmtMoneda(l.value)}</td></tr>`;
const tablaLineas = (titulo, lineas, totalLabel, total, aparte = null) => `
    <p class="seccion">${esc(titulo)}</p>
    <table class="desglose">
      <tbody>
        ${lineas.map(filaLinea).join('')}
        <tr class="tot"><td>${esc(totalLabel)}</td><td class="r">${fmtMoneda(total)}</td></tr>
        ${aparte ? `<tr class="sub"><td colspan="2">${esc(aparte.titulo)}</td></tr>${aparte.lineas.map(filaLinea).join('')}` : ''}
      </tbody>
    </table>`;

// Firma con su línea; la nota del turno, debajo.
const firma = (nombre, rol, nota) => `
      <div class="firma">
        <div class="rayita"></div>
        <p><b>${esc(nombre)}</b> <span class="rol">· ${rol}</span></p>
        ${nota ? `<p class="obs">“${esc(nota)}”</p>` : ''}
      </div>`;

/**
 * Detalle de un corte: primero las cifras del cierre; luego Ingresos y, al
 * lado, Egresos con las entradas y gastos; al final las firmas. Ventas lo reusa.
 */
export const bloqueDetalle = (c) => {
  const d = desgloseCaja(c);
  return `
  <section class="corte">
    <div class="corte-head">
      <h2>${esc(fechaLarga(fechaCorte(c)))}${c.en_curso ? ' · turno en curso' : ''}</h2>
      <span class="hora">${esc(formatHora12(c.abierta_at))} – ${esc(horaCierre(c))}</span>
    </div>
    ${resumenCorte(c)}
    <div class="dos">
      <div>
        ${tablaLineas('Ingresos', d.ingresos, d.totalIngresosLabel, d.totalIngresos,
    d.comoSeCobroDentro ? null : { titulo: 'Cómo se cobró', lineas: d.comoSeCobro })}
      </div>
      <div>
        ${tablaLineas('Egresos', d.egresos, 'Total egresos', d.totalEgresos)}
        ${tablaMovimientos(c)}
      </div>
    </div>
    <div class="firmas">
      ${firma(c.usuario_apertura || '—', 'abrió', c.notas_apertura)}
      ${c.en_curso ? '' : firma(c.cierre_automatico ? 'El sistema' : quienCerro(c), 'cerró', c.notas_cierre)}
    </div>
  </section>`;
};

// Con varios cortes, después del resumen, el detalle de cada uno.
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
          <th class="r">Entradas</th><th class="r">Gastos</th><th class="r">Esperado</th>
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

/** Abre una ventana con los cortes y lanza la impresión (Guardar como PDF). */
export function imprimirCortes(cortes, { titulo, subtitulo } = {}) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  if (lista.length === 0) return;
  const cuerpo = lista.length === 1 ? bloqueDetalle(lista[0]) : tablaResumen(lista) + detallePorCorte(lista);
  imprimirDocumento({ titulo: titulo || 'Corte de caja', subtitulo, cuerpo });
}
