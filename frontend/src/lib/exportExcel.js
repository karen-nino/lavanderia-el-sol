/**
 * Excel (.xlsx) con el formato de los reportes: columnas agrupadas por color,
 * letra grande, filas altas, encabezados fijos e importes en pesos. ExcelJS se
 * carga solo al exportar (pesa y casi nadie exporta).
 *
 * Una hoja se describe así:
 *   { nombre, grupos: [{ titulo, color, columnas: [{ titulo, ancho, tipo, alinear }] }],
 *     filas: [[valor, ...]], pie?: [[valor, ...]] (totales), atenuadas?: Set(índice de fila),
 *     nota?: 'texto bajo la tabla' }
 * Un grupo sin `titulo` no lleva la fila de títulos de grupo (hoja de un solo grupo).
 * Tipos: 'texto' (por omisión), 'fecha' ('YYYY-MM-DD'), 'moneda', 'dif'
 * (+ / − en rojo / "Cuadra"), 'signo' (+ / − en rojo), 'numero', 'notas'
 * (texto largo que se parte en renglones).
 */

import { descargarArchivo } from './exportUtils';

const LETRA = 'Arial';
const TAM = 15;
const TAM_GRUPO = 16;
const ALTO_FILA = 40;
const ALTO_GRUPO = 42;
const ALTO_ENCABEZADO = 56;

// Por grupo: fuerte (título), medio (encabezado y totales), suave (datos) y el texto del título.
const COLORES = {
  gris:   ['D5DCE5', 'E8ECF1', 'F7F9FB', '2B3645'],
  azul:   ['B9DDF7', 'DCEFFC', 'F1F8FE', '0B4F86'],
  verde:  ['BFE6CD', 'DDF2E5', 'F2FAF5', '1C6638'],
  ambar:  ['F8DCA6', 'FCEDD0', 'FEF8EE', '7A4A00'],
  morado: ['D8D0F3', 'EAE5FA', 'F7F5FD', '45338A'],
  calido: ['E2DDD6', 'EFECE8', 'FAF9F7', '4A4238'],
};

const FORMATOS = {
  moneda: '$#,##0.00;[Red]-$#,##0.00;$0.00',
  dif:    '+$#,##0.00;[Red]-$#,##0.00;"Cuadra"',
  signo:  '+$#,##0.00;[Red]-$#,##0.00;$0.00',
  fecha:  'ddd dd mmm yyyy',
  numero: '#,##0',
};

const A_LA_IZQUIERDA = new Set(['texto', 'fecha', 'notas']);

const relleno = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
const linea = (hex) => ({ style: 'thin', color: { argb: `FF${hex}` } });

/** 'YYYY-MM-DD' → Date que Excel muestra como ese mismo día (sin corrimiento por zona). */
export const fechaExcel = (iso) => {
  const s = typeof iso === 'string' ? iso.slice(0, 10) : '';
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};

// Valor de una celda según su tipo (vacío si no hay dato).
const valorCelda = (v, tipo) => {
  if (v == null || v === '') return null;
  // En una columna de fecha, un texto (la etiqueta de los totales) va tal cual.
  if (tipo === 'fecha') return fechaExcel(v) ?? v;
  if (['moneda', 'dif', 'signo', 'numero'].includes(tipo)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
};

/** Agrega una hoja al libro con el formato de los reportes. */
function agregarHoja(libro, hoja) {
  const ws = libro.addWorksheet(hoja.nombre);
  const columnas = hoja.grupos.flatMap((g) => g.columnas.map((c) => ({ ...c, color: COLORES[g.color] ?? COLORES.gris })));
  const conGrupos = hoja.grupos.some((g) => g.titulo);
  let r = 1;

  if (conGrupos) {
    let col = 1;
    for (const g of hoja.grupos) {
      const [fuerte, , , texto] = COLORES[g.color] ?? COLORES.gris;
      const fin = col + g.columnas.length - 1;
      if (fin > col) ws.mergeCells(r, col, r, fin);
      const c = ws.getCell(r, col);
      c.value = g.titulo ?? '';
      c.font = { name: LETRA, size: TAM_GRUPO, bold: true, color: { argb: `FF${texto}` } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let k = col; k <= fin; k += 1) ws.getCell(r, k).fill = relleno(fuerte);
      col = fin + 1;
    }
    ws.getRow(r).height = ALTO_GRUPO;
    r += 1;
  }

  // Encabezados
  columnas.forEach((c, i) => {
    const celda = ws.getCell(r, i + 1);
    celda.value = c.titulo;
    celda.font = { name: LETRA, size: TAM, bold: true };
    celda.fill = relleno(c.color[1]);
    celda.border = { bottom: linea('1A2230') };
    celda.alignment = {
      horizontal: c.alinear ?? (A_LA_IZQUIERDA.has(c.tipo ?? 'texto') ? 'left' : 'right'),
      vertical: 'middle', wrapText: true,
    };
    ws.getColumn(i + 1).width = c.ancho ?? 16;
  });
  ws.getRow(r).height = ALTO_ENCABEZADO;
  const filaEncabezado = r;
  r += 1;

  // Datos y totales
  const escribir = (valores, { total = false, primera = false, atenuada = false } = {}) => {
    columnas.forEach((c, i) => {
      const tipo = c.tipo ?? 'texto';
      const celda = ws.getCell(r, i + 1);
      celda.value = valorCelda(valores[i], tipo);
      celda.font = {
        name: LETRA, size: TAM, bold: total || Boolean(c.negritas),
        ...(atenuada ? { color: { argb: 'FF6B7280' } } : {}),
      };
      celda.fill = relleno(total ? c.color[1] : c.color[2]);
      celda.border = total ? (primera ? { top: linea('1A2230') } : {}) : { bottom: linea('D9DEE5') };
      if (FORMATOS[tipo]) celda.numFmt = FORMATOS[tipo];
      celda.alignment = {
        horizontal: c.alinear ?? (A_LA_IZQUIERDA.has(tipo) ? 'left' : 'right'),
        vertical: 'middle', wrapText: tipo === 'notas',
      };
    });
    ws.getRow(r).height = ALTO_FILA;
    r += 1;
  };
  hoja.filas.forEach((f, i) => escribir(f, { atenuada: hoja.atenuadas?.has(i) }));
  (hoja.pie ?? []).forEach((f, i) => escribir(f, { total: true, primera: i === 0 }));

  if (hoja.nota) {
    r += 1;
    const c = ws.getCell(r, 1);
    c.value = hoja.nota;
    c.font = { name: LETRA, size: TAM - 2, italic: true, color: { argb: 'FF4A5565' } };
  }

  // Encabezados y primera columna fijos al desplazarse.
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: filaEncabezado }];
  return ws;
}

/** Arma el libro (sin descargarlo). Útil para probar el formato. */
export async function armarLibro(hojas) {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Lavandería El Sol';
  hojas.filter(Boolean).forEach((h) => agregarHoja(libro, h));
  return libro;
}

/** Descarga las hojas como `${nombreBase}.xlsx`. */
export async function descargarExcel(nombreBase, hojas) {
  const libro = await armarLibro(hojas);
  const buffer = await libro.xlsx.writeBuffer();
  descargarArchivo(`${nombreBase}.xlsx`, buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
