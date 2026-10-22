/**
 * "Reporte diario" de Máquinas a Excel y PDF (ver exportExcel.js y
 * exportUtils.js). Recibe { fecha: 'YYYY-MM-DD', maquinas } de GET
 * /maquinas/reporte-diario.
 */

import { slug, esc, imprimirDocumento, fechaLarga } from './exportUtils';
import { descargarExcel } from './exportExcel';
import {
  tipoMaquinaTexto, esSecadora, textoDuracion, textoMoneda, totalesReporte, ciclosPorServicio,
} from './reporteMaquinas';

// 'YYYY-MM-DD' → Date local (sin corrimiento por zona horaria).
const fechaLocal = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Las notas de una máquina ese día, sin repetir: "0061, 0062".
const foliosDe = (m) => [...new Set(m.pasadas.map((p) => p.folio ?? `#${p.nota_id}`))].join(', ');

// ── Excel ───────────────────────────────────────────────────
/** Hoja del Excel del reporte diario: una fila por máquina. */
export function hojasReporteMaquinas(data) {
  const maquinas = data?.maquinas ?? [];
  return [{
    nombre: 'Máquinas',
    grupos: [
      { titulo: 'Máquina', color: 'gris', columnas: [
        { titulo: 'Máquina', ancho: 16 },
        { titulo: 'Tipo', ancho: 18 },
      ] },
      { titulo: 'Uso del día', color: 'verde', columnas: [
        { titulo: 'Ciclos Autoservicio', tipo: 'numero', ancho: 12 },
        { titulo: 'Ciclos SPE', tipo: 'numero', ancho: 10 },
        { titulo: 'Tiempo encendida', ancho: 18 },
        { titulo: 'Al tope', tipo: 'numero', ancho: 10 },
        { titulo: 'Notas', tipo: 'notas', ancho: 34 },
      ] },
      { titulo: 'Dinero', color: 'azul', columnas: [
        { titulo: 'Total', tipo: 'moneda', ancho: 14 },
      ] },
    ],
    filas: maquinas.map((m) => [
      m.nombre, tipoMaquinaTexto(m), ciclosPorServicio(m).auto, ciclosPorServicio(m).spe,
      m.usos ? textoDuracion(m.segundos) : '', m.topes, foliosDe(m), m.generado,
    ]),
  }];
}

export async function descargarReporteMaquinasExcel(data) {
  await descargarExcel(`maquinas-${slug(data?.fecha)}`, hojasReporteMaquinas(data));
}

// ── PDF (impresión del navegador) ───────────────────────────
const seccion = (titulo, maquinas) => {
  if (maquinas.length === 0) return '';
  const filas = maquinas.map((m) => `
    <tr>
      <td>${esc(m.nombre)}<br><span style="color:#6b7280">${esc(tipoMaquinaTexto(m))}</span></td>
      <td>${ciclosPorServicio(m).auto || '—'}</td>
      <td>${ciclosPorServicio(m).spe || '—'}</td>
      <td>${m.usos ? esc(textoDuracion(m.segundos)) : '—'}</td>
      <td>${m.topes || '—'}</td>
      <td>${esc(foliosDe(m)) || '—'}</td>
      <td>${m.usos ? esc(textoMoneda(m.generado)) : '—'}</td>
    </tr>`).join('');
  return `
    <div class="seccion">${esc(titulo)}</div>
    <table class="resumen">
      <thead>
        <tr><th rowspan="2">Máquina</th><th colspan="2">Ciclos</th><th rowspan="2">Tiempo encendida</th><th rowspan="2">Al tope</th><th rowspan="2">Notas</th><th rowspan="2">Total</th></tr>
        <tr><th>Autoservicio</th><th>SPE</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
};

export function imprimirReporteMaquinas(data) {
  if (!data) return;
  const maquinas = data.maquinas ?? [];
  const t = totalesReporte(maquinas);
  const cuerpo = maquinas.length === 0
    ? '<p>Sin máquinas en la sucursal.</p>'
    : `<p><strong>Ciclos:</strong> ${t.usos} · <strong>Tiempo encendida:</strong> ${esc(textoDuracion(t.segundos))}`
      + ` · <strong>Total:</strong> ${esc(textoMoneda(t.generado))}</p>`
      + seccion('Lavadoras', maquinas.filter((m) => !esSecadora(m)))
      + seccion('Secadoras', maquinas.filter(esSecadora));
  imprimirDocumento({
    titulo: 'Reporte diario de máquinas',
    subtitulo: fechaLarga(fechaLocal(data.fecha)),
    cuerpo,
  });
}
