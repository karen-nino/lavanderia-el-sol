/**
 * Cortes de caja a Excel y PDF (exportExcel.js y exportUtils.js). Cada
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
import { desgloseCaja, CONCEPTOS } from './desgloseCaja';
import {
  fmtMoneda, fechaLarga, fechaISO, slug, esc, imprimirDocumento,
} from './exportUtils';
import { descargarExcel } from './exportExcel';

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

// ── Excel ───────────────────────────────────────────────────
// Columnas en el orden en que se lee un corte (como el PDF), por grupos de color.
const gruposCortes = (conTarjeta) => [
  { titulo: 'Quién y cuándo', color: 'gris', columnas: [
    { titulo: 'Fecha', tipo: 'fecha', ancho: 24 },
    { titulo: 'Apertura', ancho: 15 },
    { titulo: 'Cierre', ancho: 15 },
    { titulo: 'Abrió', ancho: 25 },
    { titulo: 'Cerró', ancho: 25 },
  ] },
  { titulo: 'Resultado', color: 'azul', columnas: [
    { titulo: 'Esperado', tipo: 'moneda', ancho: 17, negritas: true },
    { titulo: 'Contado', tipo: 'moneda', ancho: 17 },
    { titulo: 'Diferencia', tipo: 'dif', ancho: 17, negritas: true },
    { titulo: 'Estado', ancho: 14, alinear: 'right' },
    { titulo: 'Caja final', tipo: 'moneda', ancho: 17 },
    { titulo: 'Sobre', tipo: 'moneda', ancho: 17, negritas: true },
  ] },
  { titulo: 'Lo vendido', color: 'verde', columnas: [
    ...CONCEPTOS.map(({ label }) => ({ titulo: label, tipo: 'moneda', ancho: 17 })),
    { titulo: 'Total vendido', tipo: 'moneda', ancho: 18, negritas: true },
  ] },
  { titulo: 'Cómo se cobró', color: 'ambar', columnas: [
    { titulo: 'Efectivo', tipo: 'moneda', ancho: 17 },
    { titulo: 'Transferencia', tipo: 'moneda', ancho: 18 },
    ...(conTarjeta ? [{ titulo: 'Tarjeta', tipo: 'moneda', ancho: 17 }] : []),
  ] },
  { titulo: 'El cajón', color: 'morado', columnas: [
    { titulo: 'Caja inicial', tipo: 'moneda', ancho: 17 },
    { titulo: 'Entradas', tipo: 'moneda', ancho: 16 },
    { titulo: 'Gastos', tipo: 'moneda', ancho: 16 },
    { titulo: 'Total en efectivo', tipo: 'moneda', ancho: 20, negritas: true },
    { titulo: 'SPE Debe', tipo: 'moneda', ancho: 16 },
  ] },
  { titulo: 'Notas', color: 'calido', columnas: [
    { titulo: 'Nota de apertura', tipo: 'notas', ancho: 36 },
    { titulo: 'Nota de cierre', tipo: 'notas', ancho: 45 },
  ] },
];

// Un importe del reparto por concepto (lo vendido con cualquier forma de pago;
// en cortes congelados antes del 2026-10-19, solo el efectivo), vacío si no lo trae.
const ing = (c, k) => (c.ingresos ? Number(c.ingresos[k] ?? 0) : null);

const filaCorte = (c, conTarjeta) => [
  fechaISO(fechaCorte(c)),
  formatHora12(c.abierta_at),
  horaCierre(c),
  c.usuario_apertura ?? '',
  quienCerro(c),
  c.esperado,
  c.contado,
  c.diferencia,
  estadoCorte(c),
  c.caja_final,
  c.sobre,
  ...CONCEPTOS.map(({ key }) => ing(c, key)),
  c.ventas,
  c.ventas_desglose?.efectivo ?? c.ventas,
  c.ventas_desglose?.transferencia ?? 0,
  ...(conTarjeta ? [c.ventas_desglose?.tarjeta ?? 0] : []),
  c.monto_inicial,
  c.entradas,
  c.salidas,
  desgloseCaja(c).totalIngresos,
  c.spe_debe,
  c.notas_apertura ?? '',
  c.notas_cierre ?? '',
];

// Fila de totales: suma de cada importe; vacía donde no tiene sentido sumar.
const sumaColumnas = (grupos, filas) => grupos.flatMap((g) => g.columnas).map((col, i) => {
  if (!['moneda', 'dif'].includes(col.tipo)) return null;
  const vals = filas.map((f) => f[i]).filter((v) => v != null && v !== '');
  return vals.length ? vals.reduce((a, v) => a + Number(v), 0) : null;
});

/**
 * Hojas del Excel de cortes: "Cortes" (una fila por turno y sus totales) y,
 * si hubo, "Entradas y gastos" (una fila por movimiento). Ventas las reusa.
 */
export function hojasCortes(cortes, { nombre = 'Cortes' } = {}) {
  const lista = Array.isArray(cortes) ? cortes : [cortes];
  // La columna de tarjeta solo si algún corte trae cobros con tarjeta.
  const conTarjeta = lista.some((c) => (c.ventas_desglose?.tarjeta ?? 0) > 0);
  const grupos = gruposCortes(conTarjeta);
  const filas = lista.map((c) => filaCorte(c, conTarjeta));
  const totales = lista.length > 1 ? sumaColumnas(grupos, filas) : null;
  if (totales) totales[0] = `Totales (${lista.length} cortes)`;

  const movs = lista.flatMap((c) => (c.movimientos ?? []).map((m) => [
    fechaISO(fechaCorte(c)),
    formatHora12(m.created_at),
    m.tipo === 'salida' ? 'Gasto' : 'Entrada',
    m.concepto ?? '',
    m.usuario ?? '',
    m.tipo === 'salida' ? -Number(m.monto) : Number(m.monto),
  ]));
  const suma = (tipo) => movs.filter((m) => m[2] === tipo).reduce((a, m) => a + m[5], 0);

  return [
    { nombre, grupos, filas, pie: totales ? [totales] : [] },
    movs.length > 0 && {
      nombre: 'Entradas y gastos',
      grupos: [{ color: 'gris', columnas: [
        { titulo: 'Fecha del corte', tipo: 'fecha', ancho: 25 },
        { titulo: 'Hora', ancho: 15 },
        { titulo: 'Tipo', ancho: 14 },
        { titulo: 'Concepto', ancho: 36 },
        { titulo: 'Registró', ancho: 28 },
        { titulo: 'Monto', tipo: 'signo', ancho: 18 },
      ] }],
      filas: movs,
      // Entradas y gastos por separado: sumados no dicen nada.
      pie: [['Entradas', null, null, null, null, suma('Entrada')],
            ['Gastos', null, null, null, null, suma('Gasto')]],
    },
  ].filter(Boolean);
}

// Descarga uno o varios cortes como Excel. `sufijo` va en el nombre del archivo.
export async function descargarCortesExcel(cortes, sufijo) {
  await descargarExcel(`cortes-${slug(sufijo)}`, hojasCortes(cortes));
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
