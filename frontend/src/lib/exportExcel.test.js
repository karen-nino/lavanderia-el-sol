import { describe, it, expect } from 'vitest';
import { armarLibro, fechaExcel } from './exportExcel';

const hoja = {
  nombre: 'Prueba',
  grupos: [
    { titulo: 'Quién', color: 'gris', columnas: [{ titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Nombre' }] },
    { titulo: 'Dinero', color: 'verde', columnas: [{ titulo: 'Diferencia', tipo: 'dif' }, { titulo: 'Estado', alinear: 'right' }] },
  ],
  filas: [['2026-10-19', 'Ana', -15, 'Faltante']],
  pie: [['Totales', null, -15, null]],
};

describe('armarLibro', () => {
  it('pone títulos de grupo, encabezados fijos, letra grande y filas altas', async () => {
    const ws = (await armarLibro([hoja])).getWorksheet('Prueba');
    expect(ws.getCell('A1').value).toBe('Quién');
    expect(ws.getCell('C1').value).toBe('Dinero');
    expect(ws.getCell('A2').value).toBe('Fecha');
    expect(ws.getCell('A3').font.size).toBe(15);
    expect(ws.getCell('A1').font.size).toBe(16);
    expect(ws.getRow(3).height).toBe(40);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 2 });
  });

  it('cada grupo tiene su color y las cifras su formato', async () => {
    const ws = (await armarLibro([hoja])).getWorksheet('Prueba');
    expect(ws.getCell('A3').fill.fgColor.argb).not.toBe(ws.getCell('C3').fill.fgColor.argb);
    expect(ws.getCell('C3').numFmt).toContain('[Red]');
    expect(ws.getCell('C3').value).toBe(-15);
    expect(ws.getCell('D3').alignment.horizontal).toBe('right');
    expect(ws.getCell('A4').font.bold).toBe(true);
    // La etiqueta de los totales cae en la columna de fecha y no se pierde.
    expect(ws.getCell('A4').value).toBe('Totales');
  });

  it('la fecha sale como ese mismo día, sin corrimiento por zona horaria', () => {
    expect(fechaExcel('2026-10-19').toISOString().slice(0, 10)).toBe('2026-10-19');
    expect(fechaExcel('')).toBeNull();
  });
});
