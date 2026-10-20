/**
 * "Reporte diario" de Inventario a Excel y PDF (ver exportExcel.js, exportUtils.js y
 * formatoInventario.js). Recibe { fecha: 'YYYY-MM-DD', productos } de GET
 * /productos/reporte-diario.
 */

import { slug, esc, imprimirDocumento, fechaLarga } from './exportUtils';
import { descargarExcel } from './exportExcel';
import { textoBotellas, textoGranel, seVendePorUnidad, esPolvo, lineasEntradas, lineasSalidas, lineasDevuelto } from './formatoInventario';

// 'YYYY-MM-DD' → Date local (sin corrimiento por zona horaria).
const fechaLocal = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Lo que se cuenta por unidad (marca y polvo): sin botellas ni bidón.
const esMarca  = (p) => seVendePorUnidad(p);
const nombreProd = (p) => (esMarca(p) && p.marca ? `${p.marca} · ${p.nombre}` : p.nombre);

const entradasLineas = (p) => lineasEntradas(p, esMarca(p));
// Salidas: por notas más las manuales (merma, dañado…).
const salidasLineas = (p) => lineasSalidas(p, esMarca(p));
// Ventas anuladas ese día, en su propia columna.
const devueltoTexto = (p) => lineasDevuelto(p, esMarca(p)).join(' · ');
const inicioRellenadas = (p) => textoBotellas(p.inicio_botellas_medidas, p.medidas_por_botella, { marca: esMarca(p) });
const inicioGranel = (p) => (esMarca(p) ? '' : textoGranel(p.inicio_granel_medidas, p.medidas_por_bidon, p.medidas_por_botella));
const rellenadasTexto = (p) => textoBotellas(p.fin_botellas_medidas, p.medidas_por_botella, { marca: esMarca(p) });
const granelTexto = (p) => (esMarca(p) ? '' : textoGranel(p.fin_granel_medidas, p.medidas_por_bidon, p.medidas_por_botella));

// La columna Devuelto solo si algo se devolvió ese día (como en la pantalla).
const hayDevuelto = (productos) => productos.some((p) => Number(p.devuelto_medidas) > 0);

// ── Excel ───────────────────────────────────────────────────
// Varias líneas de movimientos van una debajo de otra en la misma celda.
const enRenglones = (lineas) => lineas.join('\n');

/** Hoja del Excel del reporte diario: una fila por producto. */
export function hojasReporte(data) {
  const productos = data?.productos ?? [];
  const conDevuelto = hayDevuelto(productos);
  return [{
    nombre: 'Inventario',
    grupos: [
      { titulo: 'Producto', color: 'gris', columnas: [
        { titulo: 'Tipo', ancho: 13 },
        { titulo: 'Marca', ancho: 20 },
        { titulo: 'Producto', ancho: 30 },
      ] },
      { titulo: 'Movimientos del día', color: 'verde', columnas: [
        { titulo: 'Entradas', tipo: 'notas', ancho: 30 },
        { titulo: 'Salidas', tipo: 'notas', ancho: 30 },
        ...(conDevuelto ? [{ titulo: 'Devuelto', tipo: 'notas', ancho: 26 }] : []),
      ] },
      { titulo: 'Había al inicio', color: 'azul', columnas: [
        { titulo: 'Rellenadas', tipo: 'notas', ancho: 24 },
        { titulo: 'A granel', tipo: 'notas', ancho: 24 },
      ] },
      { titulo: 'Queda al final', color: 'morado', columnas: [
        { titulo: 'Rellenadas', tipo: 'notas', ancho: 24 },
        { titulo: 'A granel', tipo: 'notas', ancho: 24 },
      ] },
    ],
    filas: productos.map((p) => [
      esPolvo(p) ? 'Polvo' : esMarca(p) ? 'Marca' : 'Granel',
      p.marca ?? '',
      p.nombre ?? '',
      enRenglones(entradasLineas(p)),
      enRenglones(salidasLineas(p)),
      ...(conDevuelto ? [enRenglones(lineasDevuelto(p, esMarca(p)))] : []),
      inicioRellenadas(p),
      inicioGranel(p),
      rellenadasTexto(p),
      granelTexto(p),
    ]),
  }];
}

export async function descargarReporteExcel(data) {
  await descargarExcel(`inventario-${slug(data?.fecha)}`, hojasReporte(data));
}

// ── PDF (impresión del navegador) ───────────────────────────
const quedaCelda = (p) =>
  esMarca(p)
    ? esc(rellenadasTexto(p))
    : `Rellenadas: ${esc(rellenadasTexto(p))}<br>A granel: ${esc(granelTexto(p))}`;
const inicioCelda = (p) =>
  esMarca(p)
    ? esc(inicioRellenadas(p))
    : `Rellenadas: ${esc(inicioRellenadas(p))}<br>A granel: ${esc(inicioGranel(p))}`;

const seccion = (titulo, productos, conDevuelto) => {
  if (productos.length === 0) return '';
  const filas = productos.map((p) => `
    <tr>
      <td>${esc(nombreProd(p))}</td>
      <td>${entradasLineas(p).map(esc).join('<br>')}</td>
      <td>${salidasLineas(p).map(esc).join('<br>')}</td>
      ${conDevuelto ? `<td>${esc(devueltoTexto(p))}</td>` : ''}
      <td>${inicioCelda(p)}</td>
      <td>${quedaCelda(p)}</td>
    </tr>`).join('');
  return `
    <div class="seccion">${esc(titulo)}</div>
    <table class="resumen">
      <thead>
        <tr><th>Producto</th><th>Entradas</th><th>Salidas</th>${conDevuelto ? '<th>Devuelto</th>' : ''}<th>Había al inicio</th><th>Queda al final</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
};

export function imprimirReporte(data) {
  if (!data) return;
  const productos = data.productos ?? [];
  const granel = productos.filter((p) => !esMarca(p));
  const polvo  = productos.filter(esPolvo);
  const marca  = productos.filter((p) => esMarca(p) && !esPolvo(p));
  const cuerpo = productos.length === 0
    ? '<p>Sin productos en el inventario ese día.</p>'
    : (() => {
        const conDevuelto = hayDevuelto(productos);
        return seccion('Granel', granel, conDevuelto) + seccion('Polvo', polvo, conDevuelto)
          + seccion('Marca', marca, conDevuelto);
      })();
  imprimirDocumento({
    titulo: 'Reporte diario de inventario',
    subtitulo: fechaLarga(fechaLocal(data.fecha)),
    cuerpo,
  });
}
